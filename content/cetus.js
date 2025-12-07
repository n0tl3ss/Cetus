/**
Copyright 2020 Jack Baker

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const LOG_LEVEL_NONE  = 0;
const LOG_LEVEL_DEBUG  = 1;
const LOG_LEVEL_TRACE  = 2;

const MAX_SEARCH_RESULTS = 1000;

class CetusInstanceContainer {
    constructor() {
        if (typeof cetusOptions === "object") {
            this.logLevel = cetusOptions.logLevel;
        }

        this._instances = [];
        this.speedhack = new SpeedHack(1);
    }

    reserveIdentifier() {
        return this._instances.push(null) - 1;
    }

    newInstance(identifier, options) {
        if (this._instances[identifier] !== null) {
            throw new Error("Attempted to use an invalid identifier");
        }

        const newInstance = new Cetus(identifier, options);
        this._instances[identifier] = newInstance;
    }

    _validateIdentifier(identifier) {
        if (!(this._instances[identifier] instanceof Cetus)) {
            throw new Error("Requested invalid identifier " + identifier + " in CetusInstanceContainer");
        }
    }

    get(identifier) {
        this._validateIdentifier(identifier);

        return this._instances[identifier];
    }

    close(identifier) {
        this._validateIdentifier(identifier);

        this._instances[identifier].sendExtensionMessage("instanceQuit");
    }

    closeAll() {
        for (let i = 0; i < this._instances.length; i++) {
            if (this._instances[i] === null) {
                continue;
            }

            this.close(i);
        }
    }
}

class Cetus {
    constructor(identifier, env) {
        this.identifier = identifier;
        this.watchpointExports = env.watchpointExports;

        if (!(env.memory instanceof WebAssembly.Memory)) {
            colorError("Cetus received an invalid memory object! This is a bug!");
        }

        this._memObject = env.memory;
        this._buffer = env.buffer;
        this._symbols = env.symbols;

        this._searchMemory;
        this._searchMemoryType;
        this._searchMemoryTypeStr;
        this._searchMemoryElementSize;

        this._functions = null;

        this._searchSubset = {};
        this._savedMemory  = null;

        if (cetusInstances.logLevel >= LOG_LEVEL_DEBUG) {
            colorLog("constructor: Cetus initialized");
        }

        // Inform the extension that we have initialized
        this.sendExtensionMessage("init", {
            url: (window.location.host + window.location.pathname),
            symbols: this._symbols
        });
    }

    sendExtensionMessage(type, msg) {
        const msgBody = {
            id: this.identifier,
            type: type,
            body: msg
        };

        if (cetusInstances !== null && cetusInstances.logLevel >= LOG_LEVEL_TRACE) {
            colorLog("Sending message to extension: " + bigintJsonStringify(msgBody));
        }

        const evt = new CustomEvent("cetusMsgIn", { detail: bigintJsonStringify(msgBody) } );

        window.dispatchEvent(evt);
    };

    createSearchMemory(memTypeStr, memAligned = true) {
        if (memAligned) {
            this._searchMemory = this.alignedMemory(memTypeStr);
        }
        else {
            this._searchMemory = this.unalignedMemory();
        }

        this._searchMemoryTypeStr = memTypeStr;
        this._searchMemoryType = getMemoryType(memTypeStr);
        this._searchMemoryElementSize = getElementSize(memTypeStr);
    }

    // Accessing aligned memory is faster because we can just treat the whole
    // memory object as the relevant typed array (Like Uint32Array)
    // This is not as thorough, however, because we will miss matching values
    // that are not stored at naturally-aligned addresses
    alignedMemory(memTypeStr) {
        const memType = getMemoryType(memTypeStr);

        // We return a new object each time because the WebAssembly.Memory object
        // will detach if it is resized
        return new memType(this._memObject.buffer);
    }

    // When we need to access unaligned memory addresses, we treat memory as a
    // Uint8Array so that we can read at any "real" address
    unalignedMemory() {
        return new Uint8Array(this._memObject.buffer);
    }

    getMemorySize() {
        return this.unalignedMemory().length;
    }

    queryMemory(address, memTypeStr) {
        if (typeof address === "string") {
            address = parseInt(address);
        }

        const memory = this.unalignedMemory();
        const memType = getMemoryType(memTypeStr);
        const memSize = getElementSize(memTypeStr);

        const tempBuf = new Uint8Array(memSize);

        for (let i = 0; i < tempBuf.length; i++) {
            tempBuf[i] = memory[address + i];
        }

        return new memType(tempBuf.buffer)[0];
    }

    queryMemoryChunk(address, length) {
        if (typeof address === "string") {
            address = parseInt(address);
        }

        const memory = this.unalignedMemory();
        const memType = Uint8Array;
        const memSize = 1;

        const tempBuf = new Uint8Array(length);

        for (let i = 0; i < length; i++) {
            tempBuf[i] = memory[address + i];
        }

        return new Uint8Array(tempBuf.buffer);
    }

    // These two functions should typically only be used by the internal search
    // They use pre-loaded values to speed up the process of doing repetitive searches
    _queryMemoryUnalignedQuick(address) {
        const tempBuf = new Uint8Array(this._searchMemoryElementSize);

        address = parseInt(address);

        for (let i = 0; i < this._searchMemoryElementSize; i++) {
            tempBuf[i] = this._searchMemory[address + i];
        }

        return new this._searchMemoryType(tempBuf.buffer)[0];
    }

    _queryMemoryAlignedQuick(address) {
        const memIndex = realAddressToIndex(address, this._searchMemoryTypeStr);

        return this._searchMemory[memIndex];
    }

    restartSearch() {
        this._searchSubset = {};
        this._savedMemory = null;

        if (cetusInstances.logLevel >= LOG_LEVEL_DEBUG) {
            colorLog("restartSearch: Search restarted");
        }
    }

    _compare(comparator, memType, memAligned, lowerBound, upperBound) {
        const searchKeys = Object.keys(this._searchSubset);

        if (searchKeys.length == 0) {
            if (memAligned) {
                const memSize = getElementSize(memType);

                for (let i = lowerBound; i <= upperBound; i += memSize) {
                    const currentValue = this._queryMemoryAlignedQuick(i, memType);

                    if (comparator(currentValue) == true) {
                        this._searchSubset[i] = currentValue;
                    }
                }
            }
            else {
                for (let i = lowerBound; i <= upperBound; i++) {
                    const currentValue = this._queryMemoryUnalignedQuick(i, memType);

                    if (comparator(currentValue) == true) {
                        this._searchSubset[i] = currentValue;
                    }
                }
            }
        }
        else {
            for (let entry in this._searchSubset) {
                let currentValue;

                if (memAligned) {
                    currentValue = this._queryMemoryAlignedQuick(entry, memType);
                }
                else {
                    currentValue = this._queryMemoryUnalignedQuick(entry, memType);
                }

                if (cetusInstances.logLevel >= LOG_LEVEL_TRACE) {
                    colorLog("_compare: Looping subset search. Entry: " + entry + "  Value: " + currentValue);
                }                
                
                if (entry < lowerBound || entry > upperBound || comparator(currentValue) == false) {
                    delete this._searchSubset[entry];
                }
                else {
                    this._searchSubset[entry] = currentValue;
                }
            }
        }

        const searchObj = {};

        searchObj.count = Object.keys(this._searchSubset).length;

        // If we try to send too much data to the extension, we'll probably freeze the tab. Instead, if there are too many search results we
        // send the accurate number of results, but don't actually send the matches
        if (searchObj.count <= MAX_SEARCH_RESULTS) {
            searchObj.results = this._searchSubset;
        }
        else {
            searchObj.results = [];
        }

        return searchObj;
    }

    // TODO Should support unaligned searching
    _diffCompare(comparator, memType, lowerBoundIndex, upperBoundIndex) {
        const memory = this.alignedMemory(memType);

        if (Object.keys(this._searchSubset).length == 0) {
            for (let i = lowerBoundIndex; i < upperBoundIndex; i++) {
                if (comparator(memory[i], this._savedMemory[i]) == true) {
                    const realAddress = indexToRealAddress(i, memType);
                    this._searchSubset[realAddress] = memory[i];
                }
            }
        }
        else {
            for (let entryAddr in this._searchSubset) {
                const entryIndex = realAddressToIndex(entryAddr, memType);
                if (entryIndex < lowerBoundIndex ||
                    entryIndex > upperBoundIndex ||
                    comparator(memory[entryIndex], this._savedMemory[entryAddr]) == false) {
                    delete this._searchSubset[entryAddr];
                }
                else {
                    this._searchSubset[entryAddr] = memory[entryIndex];
                }
            }
        }

        this._savedMemory = this._searchSubset;

        const searchObj = {};

        searchObj.count = Object.keys(this._searchSubset).length;

        // If we try to send too much data to the extension, we'll probably freeze the tab. Instead, if there are too many search results we
        // send the accurate number of results, but don't actually send the matches
        if (searchObj.count <= MAX_SEARCH_RESULTS) {
            searchObj.results = this._searchSubset;
        }
        else {
            searchObj.results = [];
        }

        return searchObj;
    }

    search(searchComparison, searchMemType, searchMemAlign, searchParam = null, lowerBound = 0, upperBound = 0xFFFFFFFF) {
        this.createSearchMemory(searchMemType, searchMemAlign);

        const memSize = this.getMemorySize();

        let lowerBoundAddr = parseInt(lowerBound);
        let upperBoundAddr = parseInt(upperBound);

        // If we are searching aligned addresses, we want to make sure our lower bound is aligned
        if (searchMemAlign) {
            lowerBoundAddr -= (lowerBoundAddr % getElementSize(searchMemType));
        }

        if (upperBoundAddr >= memSize) {
            upperBoundAddr = memSize - 1;
        }

        const lowerBoundIndex = realAddressToIndex(lowerBoundAddr, searchMemType);
        const upperBoundIndex = realAddressToIndex(upperBoundAddr, searchMemType);

        let realLowerBoundIndex = lowerBoundIndex;
        let realUpperBoundIndex = upperBoundIndex;

        if (realLowerBoundIndex < 0) {
            realLowerBoundIndex = 0;
        }

        let comparator;

        switch (searchComparison) {
            case "eq":
                comparator = (searchParam !== null) ? 
                    ((memValue) => memValue == searchParam) :
                    ((current, saved) => current == saved);
                break;
            case "ne":
                comparator = (searchParam !== null) ? 
                    ((memValue) => memValue != searchParam) :
                    ((current, saved) => current != saved);
                break;
            case "lt":
                comparator = (searchParam !== null) ? 
                    ((memValue) => memValue < searchParam) :
                    ((current, saved) => current < saved);
                break;
            case "lte":
                comparator = (searchParam !== null) ? 
                    ((memValue) => memValue <= searchParam) :
                    ((current, saved) => current <= saved);
                break;
            case "gt":
                comparator = (searchParam !== null) ? 
                    ((memValue) => memValue > searchParam) :
                    ((current, saved) => current > saved);
                break;
            case "gte":
                comparator = (searchParam !== null) ? 
                    ((memValue) => memValue >= searchParam) :
                    ((current, saved) => current >= saved);
                break;
            default:
                throw new Error("Invalid search comparison " + searchComparison);
        }

        let searchResults = {};

        // If searchParam is null or not provided, the user is attempting a differential search
        // If this is the first search of a differential search, we just want to
        // collect a slice of the memory object of that type.
        if (searchParam === null) {
            if (this._savedMemory == null) {
                // TODO Should support unaligned searching
                this._savedMemory = this.alignedMemory(searchMemType).slice(realLowerBoundIndex, realUpperBoundIndex + 1);

                searchResults.count = this._savedMemory.length;

                if (this._savedMemory.length <= MAX_SEARCH_RESULTS) {
                    const realResults = {};

                    for (let i = 0; i < this._savedMemory.length; i++) {
                        const realAddress = indexToRealAddress(realLowerBoundIndex + i, searchMemType);
                        realResults[realAddress] = this._savedMemory[i];
                    }

                    searchResults.results = realResults;
                }
                else {
                    searchResults.results = [];
                }
            }
            else {
                searchResults = this._diffCompare(comparator,
                                                  searchMemType,
                                                  realLowerBoundIndex,
                                                  realUpperBoundIndex);
            }
        }
        else {
            searchResults = this._compare(comparator,
                                          searchMemType,
                                          searchMemAlign,
                                          lowerBoundAddr,
                                          upperBoundAddr);
        }

        if (cetusInstances.logLevel >= LOG_LEVEL_DEBUG) {
            colorLog("search: exiting search");
        }

        return searchResults;
    }

    patternSearch(searchMemType, searchParam, lowerBound, upperBound) {
        const result = {};

        let realLowerBound = parseInt(lowerBound);
        let realUpperBound = parseInt(upperBound);

        if (realLowerBound < 0) {
            realLowerBound = 0;
        }

        const memSize = this.getMemorySize();

        if (realUpperBound >= memSize) {
            realUpperBound = memSize - 1;
        }

        let realParam;

        switch (searchMemType) {
            case "ascii":
                realParam = new Uint8Array(searchParam.length);

                for (let i = 0; i < searchParam.length; i++) {
                    realParam[i] = searchParam.charCodeAt(i);
                }

                break;
            case "utf-8":
                const tempBuf = new Uint16Array(searchParam.length);

                for (let i = 0; i < searchParam.length; i++) {
                    realParam[i] = searchParam.charCodeAt(i);
                }

                realParam = new Uint8Array(tempBuf.buffer);

                break;
            case "bytes":
                const split1 = [...searchParam.trim().matchAll(/\\x[0-9a-f]{2}(?![0-9a-z])/gi)];
                const split2 = searchParam.trim().split(/\\x/);

                if ((split1.length != (split2.length - 1)) || split1.length == 0) {
                    // Something is wrong in the byte sequence
                    console.error("Wrong byte sequence format");
                    return;
                }

                split2.shift();

                realParam = new Uint8Array(split2.length);

                for (let i = 0; i < searchParam.length; i++) {
                    realParam[i] = parseInt(split2[i], 16);
                }

                break;
        }

        const searchResults = this.bytesSequence(realParam);

        result.results = {};

        for (let i = 0; i < searchResults.length; i++) {
            const hitAddr = searchResults[i];

            result.results[hitAddr] = searchParam;
        }

        result.count = searchResults.length;

        return result;
    }

    setSpeedhackMultiplier(multiplier) {
        if (bigintIsNaN(multiplier)) {
            return;
        }

        cetusInstances.speedhack.multiplier = multiplier;
    }

    _resolveFunctions() {
        const wail = new WailParser(this._buffer);

        const results = {};

        wail.addCodeElementParser(null, function(funcOptions) {
            const funcIndex = funcOptions.index;

            results[funcIndex] = funcOptions.bytes;
        
            return false;
        });

        wail.parse();

        this._functions = results;

        // As is, this._buffer is only used to resolve functions so it's safe to get rid
        // of it once functions have been resolved
        this._buffer = null;
    }

    queryFunction(funcIndex) {
        if (this._functions === null) {
            this._resolveFunctions();
        }

        if (!bigintIsNaN(funcIndex) && typeof this._functions[funcIndex] === "object") {
            return this._functions[funcIndex];
        }
    }

    // Cetus API function used to manually add bookmarks
    addBookmark(memAddr, memType) {
        if (typeof memAddr !== "number") {
            throw new Error("addBookmark() expects argument 0 to be a number");
        }

        if (!isValidMemType(memType)) {
            throw new Error("Invalid memory type in addBookmark()");
        }

        this.sendExtensionMessage("addBookmark", {
            address: memAddr,
            memType: memType
        });
    }

    // Cetus API function for manually modifying memory
    modifyMemory(memAddr, memValue, memTypeStr = "i32") {
        if (typeof memAddr === "string") {
            memAddr = parseInt(memAddr);
        }
        if (typeof memValue === "string") {
            memValue = parseInt(memValue);
        }

        const memory = this.unalignedMemory();
        const memType = getMemoryType(memTypeStr);

        if (memAddr < 0 || memAddr >= memory.length) {
            throw new RangeError("Address out of range in Cetus.modifyMemory()");
        }

        const tempBuf = new memType(1);
        tempBuf[0] = memValue;

        const byteBuf = new Uint8Array(tempBuf.buffer);

        for (let i = 0; i < byteBuf.length; i++) {
            memory[memAddr + i] = byteBuf[i];
        }
    }

    strings(minLength = 4) {
        let ascii =  this.asciiStrings(minLength);
        let unicode = this.unicodeStrings(minLength);

        return Object.assign(ascii.results, unicode.results);
    }

    asciiStrings(minLength = 4) {
        if (minLength < 1) {
            console.error("Minimum length must be at least 1!");
            return {
                count: 0,
                results: {}
            };
        }
        else if (minLength < 4) {
            console.warn("Using minimum length " + minLength + ". This will probably return a lot of results!");
        }

        const memory = this.alignedMemory("i8");

        const searchResults = {};
        const results = {};

        let current = [];

        if (cetusInstances.logLevel >= LOG_LEVEL_DEBUG) {
            colorLog("asciiStrings: entering ASCII string search");
        }
   
        for (let i = 0; i < memory.length; i++) {
            const thisByte = memory[i];

            if (thisByte >= 0x20 && thisByte < 0x7f) {
                current.push(thisByte);
                continue;
            }

            if (current.length >= minLength) {
                let thisString = "";

                for (let j = 0; j < current.length; j++) {
                    thisString += String.fromCharCode(current[j]);
                }

                results[i - current.length] = thisString;

                if (cetusInstances.logLevel >= LOG_LEVEL_TRACE) {
                    colorLog("asciiStrings: string found: " + thisString);
                }
            }

            current = [];
        }

        if (cetusInstances.logLevel >= LOG_LEVEL_DEBUG) {
            colorLog("asciiStrings: exiting ASCII string search");
        }

        searchResults.count = Object.keys(results).length;
        searchResults.results = results;

        return searchResults;
    }

    unicodeStrings(minLength = 4) {
        if (minLength < 1) {
            console.error("Minimum length must be at least 1!");
            return {
                count: 0,
                results: {}
            };
        }
        else if (minLength < 4) {
            console.warn("Using minimum length " + minLength + ". This will probably return a lot of results!");
        }

        const searchResults = {};
        const results = {};

        const memory = this.alignedMemory("i16");

        let current = [];

        if (cetusInstances.logLevel >= LOG_LEVEL_DEBUG) {
            colorLog("unicodeStrings: entering UNICODE string search");
        }
    
        for (let i = 0; i < memory.length; i++) {
            const thisByte = memory[i];

            if (thisByte) {
                current.push(thisByte);
                continue;
            }

            if (current.length >= minLength) {
                let thisString = "";

                for (let j = 0; j < current.length; j++) {
                    thisString += String.fromCharCode(current[j]);
                }

                if (thisString.length >= minLength) {
                    results[i - current.length] = thisString;

                    if (cetusInstances.logLevel >= LOG_LEVEL_TRACE) {
                        colorLog("unicodeStrings: string found: " + thisString);
                    }
                }    
            }

            current = [];
        }

        if (cetusInstances.logLevel >= LOG_LEVEL_DEBUG) {
            colorLog("unicodeStrings: exiting UNICODE string search");
        }

        searchResults.count = Object.keys(results).length;
        searchResults.results = results;

        return searchResults;
    }

    // ASCII string search within an address range [lowerBound, upperBound]
    asciiStringsInRange(minLength = 4, lowerBound = 0, upperBound = 0xFFFFFFFF) {
        if (minLength < 1) {
            return { count: 0, results: {} };
        }

        const memory = this.alignedMemory("i8");
        const results = {};
        const memLen = memory.length;

        let lb = parseInt(lowerBound);
        let ub = parseInt(upperBound);

        if (isNaN(lb) || lb < 0) lb = 0;
        if (isNaN(ub) || ub >= memLen) ub = memLen - 1;

        let current = [];

        for (let i = lb; i <= ub; i++) {
            const thisByte = memory[i];

            // printable ASCII 0x20..0x7E
            if (thisByte >= 0x20 && thisByte < 0x7f) {
                current.push(thisByte);
            } else {
                if (current.length >= minLength) {
                    let thisString = "";
                    for (let j = 0; j < current.length; j++) {
                        thisString += String.fromCharCode(current[j]);
                    }
                    results[i - current.length] = thisString;
                }
                current = [];
            }
        }

        // flush at end of range
        if (current.length >= minLength) {
            let thisString = "";
            for (let j = 0; j < current.length; j++) {
                thisString += String.fromCharCode(current[j]);
            }
            results[ub + 1 - current.length] = thisString;
        }

        return {
            count: Object.keys(results).length,
            results: results
        };
    }

    // UTF-16 (i16) zero-terminated string scan within [lowerBound, upperBound]
    unicodeStringsInRange(minLength = 4, lowerBound = 0, upperBound = 0xFFFFFFFF) {
        if (minLength < 1) {
            return { count: 0, results: {} };
        }

        // i16 view; index step is 1 element == 2 bytes
        const memory = this.alignedMemory("i16");
        const byteLen = this.getMemorySize();

        let lb = parseInt(lowerBound);
        let ub = parseInt(upperBound);

        if (isNaN(lb) || lb < 0) lb = 0;
        if (isNaN(ub) || ub >= byteLen) ub = byteLen - 1;

        // convert real byte bounds to i16 indices
        let lbIdx = Math.floor(lb / 2);
        let ubIdx = Math.floor(ub / 2);
        if (lbIdx < 0) lbIdx = 0;
        if (ubIdx >= memory.length) ubIdx = memory.length - 1;

        const results = {};
        let current = [];

        for (let i = lbIdx; i <= ubIdx; i++) {
            const ch = memory[i];

            if (ch) {
                current.push(ch);
            } else {
                if (current.length >= minLength) {
                    let s = "";
                    for (let j = 0; j < current.length; j++) {
                        s += String.fromCharCode(current[j]);
                    }
                    if (s.length >= minLength) {
                        // convert i16 index to real address (bytes)
                        const startAddr = (i - current.length) * 2;
                        results[startAddr] = s;
                    }
                }
                current = [];
            }
        }

        // flush at end of range
        if (current.length >= minLength) {
            let s = "";
            for (let j = 0; j < current.length; j++) {
                s += String.fromCharCode(current[j]);
            }
            if (s.length >= minLength) {
                const startAddr = ((ubIdx + 1) - current.length) * 2;
                results[startAddr] = s;
            }
        }

        return {
            count: Object.keys(results).length,
            results: results
        };
    }

    bytesSequence(bytesSeq) {
        if (cetusInstances.logLevel >= LOG_LEVEL_DEBUG) {
            colorLog("bytesSequence: entering bytes sequence search with parameter " + bytesSeq);
        }

        if (bytesSeq.length < 1) {
            console.error("Minimum length must be at least 1!");
            return [];
        }
        else if (bytesSeq.length < 4) {
            console.warn("Sequence length is small: " + bytesSeq.length + ". This will probably return a lot of results!");
        }

        const results = [];

        const memory = this.alignedMemory("i8");

        let match = 0;

        for (let i = 0; i < memory.length; i++) {
            const thisByte = memory[i];

            if (thisByte == bytesSeq[match]) {
                match++;
                continue;
            }
            
            if (match == bytesSeq.length) {

                results.push(i - bytesSeq.length);
                match = 0;

                if (cetusInstances.logLevel >= LOG_LEVEL_TRACE) {
                    colorLog("bytesSequence: sequence found: " + bytesSeq);
                }
            } else {
                match = 0;
            }
        }

        if (cetusInstances.logLevel >= LOG_LEVEL_DEBUG) {
            colorLog("bytesSequence: exiting bytes sequence search");
        }

        return results;
    }

    async detectTimers(durationSec = 1.5, strideBytes = 32, lowerBound = 0, upperBound = 0xFFFFFFFF) {
        // Heuristic: sample aligned f32 values, wait duration, compute rate/s,
        // keep addresses near +/- 1.0 per second
        const memTypeStr = "f32";
        const elemSize = getElementSize(memTypeStr);

        // Normalize inputs
        let stride = parseInt(strideBytes);
        if (isNaN(stride) || stride < elemSize) {
            stride = elemSize;
        }
        // Ensure stride is multiple of element size (4 bytes)
        stride -= (stride % elemSize);

        let lb = parseInt(lowerBound);
        let ub = parseInt(upperBound);

        if (isNaN(lb) || lb < 0) lb = 0;

        const memSizeBytes = this.getMemorySize();
        if (isNaN(ub) || ub >= memSizeBytes) {
            ub = memSizeBytes - 1;
        }

        // Align lower bound for aligned scan
        lb -= (lb % elemSize);

        // Snapshot 1
        const mem = this.alignedMemory(memTypeStr);

        const startValues = {};
        for (let addr = lb; addr <= ub; addr += stride) {
            const idx = realAddressToIndex(addr, memTypeStr);
            if (idx < 0 || idx >= mem.length) {
                continue;
            }
            const v = mem[idx];
            if (Number.isFinite(v)) {
                startValues[addr] = v;
            }
        }

        const t0 = (typeof performance !== "undefined" && typeof performance.now === "function")
            ? performance.now()
            : Date.now();

        const ms = Math.max(50, Math.floor(parseFloat(durationSec) * 1000));
        await new Promise((res) => setTimeout(res, ms));

        const t1 = (typeof performance !== "undefined" && typeof performance.now === "function")
            ? performance.now()
            : Date.now();

        const dt = Math.max(0.001, (t1 - t0) / 1000.0);

        const candidates = [];

        // Snapshot 2 and rate calc
        for (const addrStr of Object.keys(startValues)) {
            const addr = parseInt(addrStr);
            const idx = realAddressToIndex(addr, memTypeStr);
            if (idx < 0 || idx >= mem.length) {
                continue;
            }

            const v0 = startValues[addr];
            const v1 = mem[idx];

            if (!Number.isFinite(v1)) continue;

            const rate = (v1 - v0) / dt;

            const diffUp = Math.abs(rate - 1.0);
            const diffDown = Math.abs(rate + 1.0);

            // 15% tolerance around 1.0/s
            const tol = 0.15;
            if (diffUp <= tol || diffDown <= tol) {
                const behavior = (diffUp <= diffDown) ? "up(+1/s)" : "down(-1/s)";
                const score = Math.min(diffUp, diffDown);
                candidates.push({ addr, value: v1, rate, behavior, score });
            }
        }

        // If nothing matched ±1.0/s within tolerance, retry with wider tolerance,
        // then fallback to generic monotonic negative/positive rates (unknown magnitude).
        if (candidates.length === 0) {
            // Wider tolerance around ±1.0
            const tol2 = 0.35;
            for (const addrStr of Object.keys(startValues)) {
                const addr = parseInt(addrStr);
                const idx = realAddressToIndex(addr, memTypeStr);
                if (idx < 0 || idx >= mem.length) continue;

                const v0 = startValues[addr];
                const v1 = mem[idx];
                if (!Number.isFinite(v1)) continue;

                const rate2 = (v1 - v0) / dt;

                const dUp2 = Math.abs(rate2 - 1.0);
                const dDown2 = Math.abs(rate2 + 1.0);

                if (dUp2 <= tol2 || dDown2 <= tol2) {
                    const behavior = (dUp2 <= dDown2) ? "up(+1/s)" : "down(-1/s)";
                    const score = Math.min(dUp2, dDown2);
                    candidates.push({ addr, value: v1, rate: rate2, behavior, score });
                }
            }
        }

        if (candidates.length === 0) {
            // Fallback: collect monotonic-like rates with unknown magnitude.
            const alt = [];
            const minRate = 0.01; // minimum magnitude (units per second) to consider meaningful
            for (const addrStr of Object.keys(startValues)) {
                const addr = parseInt(addrStr);
                const idx = realAddressToIndex(addr, memTypeStr);
                if (idx < 0 || idx >= mem.length) continue;

                const v0 = startValues[addr];
                const v1 = mem[idx];
                if (!Number.isFinite(v1)) continue;

                const r = (v1 - v0) / dt;
                if (!Number.isFinite(r)) continue;

                if (Math.abs(r) >= minRate) {
                    const behavior = (r >= 0) ? `up(${r.toFixed(3)}/s)` : `down(${r.toFixed(3)}/s)`;
                    // Score by closeness to 1.0/s; if not close, we'll sort by magnitude next
                    alt.push({ addr, value: v1, rate: r, behavior, score: Math.abs(Math.abs(r) - 1.0) });
                }
            }

            // Prefer rates closest to 1.0/s (if any), then by larger magnitude
            alt.sort((a, b) => (a.score - b.score) || (Math.abs(b.rate) - Math.abs(a.rate)));

            // Move top alt into candidates (cap will be applied later)
            for (let i = 0; i < alt.length; i++) {
                candidates.push(alt[i]);
                if (candidates.length >= 200) break;
            }
        }

        // Sort by closeness to +/-1.0
        candidates.sort((a, b) => a.score - b.score);

        // Cap results to avoid flooding UI
        const MAX_RESULTS = 200;
        const top = candidates.slice(0, MAX_RESULTS);

        const results = {};
        for (const c of top) {
            results[c.addr] = { value: c.value, rate: c.rate, behavior: c.behavior };
        }

        return {
            count: top.length,
            results: results
        };
    }

    // AES S-Box for detection (256 bytes)
    _aesSBox() {
        return new Uint8Array([
            0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
            0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
            0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
            0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
            0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
            0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
            0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
            0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
            0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
            0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
            0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
            0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
            0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
            0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
            0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
            0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16
        ]);
    }

    _entropy(bytes) {
        const count = new Array(256).fill(0);
        for (let i = 0; i < bytes.length; i++) count[bytes[i]]++;
        let H = 0;
        for (let i = 0; i < 256; i++) {
            if (count[i] === 0) continue;
            const p = count[i] / bytes.length;
            H -= p * Math.log2(p);
        }
        return H;
    }

    // ULEB128 encoder for scanning immediates in function bodies
    _encodeULEB128(n) {
        const out = [];
        let value = (n >>> 0);
        do {
            let byte = value & 0x7F;
            value >>>= 7;
            if (value !== 0) byte |= 0x80;
            out.push(byte);
        } while (value !== 0);
        return new Uint8Array(out);
    }

    // Find functions that reference an address (optionally within a small window) via i32.const immediates
    _findFunctionsReferencingAddress(addr, windowBytes = 0, maxFuncs = 50) {
        try {
            if (this._functions === null) {
                this._resolveFunctions();
            }
        } catch (_) {
            // If buffer resolution isn't available, skip
        }
        if (!this._functions) return [];

        const center = parseInt(addr);
        if (!Number.isFinite(center) || center < 0) return [];

        const tries = [center];
        if (windowBytes > 0) {
            const step = 16;
            for (let d = step; d <= windowBytes; d += step) {
                tries.push(center + d);
                if (center - d >= 0) tries.push(center - d);
            }
        }

        const candidates = new Set();
        const keys = Object.keys(this._functions);
        // Precompute all encoded needles
        const needles = tries.map((v) => {
            const enc = this._encodeULEB128(v);
            return new Uint8Array([0x41, ...enc]); // 0x41 = i32.const
        });

        for (let i = 0; i < keys.length; i++) {
            const idx = parseInt(keys[i]);
            const bytes = this._functions[idx];
            if (!(bytes instanceof Uint8Array)) continue;

            // naive subsequence search
            let found = false;
            for (let n = 0; n < needles.length && !found; n++) {
                const needle = needles[n];
                for (let p = 0; p + needle.length <= bytes.length; p++) {
                    let ok = true;
                    for (let q = 0; q < needle.length; q++) {
                        if (bytes[p + q] !== needle[q]) { ok = false; break; }
                    }
                    if (ok) { found = true; break; }
                }
            }

            if (found) {
                candidates.add(idx);
                if (candidates.size >= maxFuncs) break;
            }
        }

        return Array.from(candidates);
    }

    // Helper: Given an AES S-Box base address, list likely user functions
    findSBoxUsers(sboxAddr, windowBytes = 512, maxFuncs = 50) {
        if (bigintIsNaN(sboxAddr)) return [];
        return this._findFunctionsReferencingAddress(parseInt(sboxAddr), windowBytes, maxFuncs);
    }

    // Helper: Scan a window around an address for key-sized high-entropy blocks (uses detectCrypto internally)
    keyScanAround(centerAddr, radius = 8192, strideBytes = 16) {
        const memSize = this.getMemorySize();
        let center = parseInt(centerAddr);
        if (!Number.isFinite(center)) return { count: 0, results: {} };

        let lb = center - parseInt(radius);
        let ub = center + parseInt(radius);
        if (isNaN(lb) || lb < 0) lb = 0;
        if (isNaN(ub) || ub >= memSize) ub = memSize - 1;

        return this.detectCrypto(strideBytes, lb, ub);
    }

    // Heuristic crypto artifact/key detection (DES/AES sizes + AES S-Box)
    detectCrypto(strideBytes = 16, lowerBound = 0, upperBound = 0xFFFFFFFF) {
        const mem = this.unalignedMemory();

        let stride = parseInt(strideBytes);
        if (isNaN(stride) || stride < 16) stride = 16; // minimum stride for speed

        let lb = parseInt(lowerBound);
        let ub = parseInt(upperBound);

        if (isNaN(lb) || lb < 0) lb = 0;
        if (isNaN(ub) || ub >= mem.length) ub = mem.length - 1;

        // Candidate sizes: DES(8), AES-128(16), AES-192(24), AES-256(32)
        const sizes = [8, 16, 24, 32];
        const results = [];
        const sbox = this._aesSBox();

        outer: for (let addr = lb; addr + 32 <= ub; addr += stride) {
            // AES S-Box table detection (exact 256-byte sequence)
            if (addr + 256 <= ub) {
                let match = true;
                for (let i = 0; i < 256; i++) {
                    if (mem[addr + i] !== sbox[i]) { match = false; break; }
                }
                if (match) {
                    results.push({ addr, len: 256, entropy: this._entropy(mem.slice(addr, addr + 256)), tag: 'aes_sbox' });
                    if (results.length >= 200) break outer;
                }
            }

            // High-entropy blocks around key sizes
            for (let k = 0; k < sizes.length; k++) {
                const sz = sizes[k];
                if (addr + sz > ub + 1) continue;
                const slice = mem.slice(addr, addr + sz);
                const H = this._entropy(slice);

                // Heuristic thresholds (bytes close to random)
                let threshold = 7.2;
                if (sz === 8) threshold = 6.5;
                if (H >= threshold) {
                    results.push({ addr, len: sz, entropy: H });
                    if (results.length >= 200) break outer;
                }
            }
        }

        // Order: S-Box first, then highest entropy, then longer length
        results.sort((a, b) => {
            const at = a.tag === 'aes_sbox' ? 1 : 0;
            const bt = b.tag === 'aes_sbox' ? 1 : 0;
            if (at !== bt) return bt - at;
            if (b.entropy !== a.entropy) return b.entropy - a.entropy;
            return (b.len || 0) - (a.len || 0);
        });

        const MAX_RESULTS = 200;
        const top = results.slice(0, MAX_RESULTS);

        const out = {};
        for (const r of top) {
            out[r.addr] = { len: r.len, entropy: r.entropy, tag: r.tag };
        }

        return { count: top.length, results: out };
    }
}

class SpeedHack {
    constructor(multiplier) {
        this.multiplier = multiplier;

        // Just in case we get injected twice, we need to make sure we don't overwrite
        // the old saved functions
        if (Date.now !== speedHackDateNow) {
            this.oldDn = Date.now;
            Date.now = speedHackDateNow;
        }
        else {
            this.oldDn = cetusInstances.speedhack.oldDn;
        }

        if (performance.now !== speedHackPerformanceNow) {
            this.oldPn = performance.now;
            performance.now = speedHackPerformanceNow;
        }
        else {
            this.oldPn = cetusInstances.speedhack.oldPn;
        }

        this.startDn = this.oldDn.call(Date);
        this.startPn = this.oldPn.call(performance);
        this.lastDn = this.startDn;
        this.lastPn = this.startPn;
        this.cumulativeDn = 0;
        this.cumulativePn = 0;
    }
}

const speedHackDateNow = function() {
    const sh = cetusInstances.speedhack;

    const real = sh.oldDn.call(Date);
    const elapsed = (real - sh.lastDn) * sh.multiplier;

    const result = Math.floor(sh.startDn + sh.cumulativeDn + elapsed);

    sh.cumulativeDn += elapsed;
    sh.lastDn = real;

    return result
};

const speedHackPerformanceNow = function() {
    const sh = cetusInstances.speedhack;

    const real = sh.oldPn.call(performance);
    const elapsed = (real - sh.lastPn) * sh.multiplier;

    const result = Math.floor(sh.startPn + sh.cumulativePn + elapsed);

    sh.cumulativePn += elapsed;
    sh.lastPn = real;

    return result
};

// TODO Change the look of this
const colorLog = function(msg) {
    console.log("%c %c \u{1f419} CETUS %c %c " + msg + " %c %c",
        "background: #858585; padding:5px 0;",
        "color: #FFFFFF; background: #000000; padding:5px 0;",
        "background: #858585; padding:5px 0;",
        "color: #FFFFFF; background: #464646; padding:5px 0;",
        "background: #858585; padding:5px 0;",
        "color: #ff2424; background: #fff; padding:5px 0;");
};

const colorError = function(msg) {
    console.log("%c %c \u{1f419} CETUS %c %c " + msg + " %c %c",
        "background: #858585; padding:5px 0;",
        "color: #eb4034; background: #000000; padding:5px 0;",
        "background: #858585; padding:5px 0;",
        "color: #eb4034; background: #464646; padding:5px 0;",
        "background: #858585; padding:5px 0;",
        "color: #ff2424; background: #fff; padding:5px 0;");
};

// TODO Validation on all these messages
window.addEventListener("cetusMsgOut", function(msgRaw) {
    if (cetusInstances == null) {
        return;
    }

    const msg = bigintJsonParse(msgRaw.detail);

    const msgType = msg.type;
    const msgBody = msg.body;

    if (typeof msgType !== "string") {
        return;
    }

    let cetus;

    try {
        cetus = cetusInstances.get(msg.id);
    } catch (e) {
        // Since extension messages are sent to all frames, there's a good chance a frame will get a message without Cetus being
        // initialized. In this case, we just drop the message
        return;
    }

    if (typeof cetus === "undefined") {
        return;
    }

    if (cetusInstances !== null && cetusInstances.logLevel >= LOG_LEVEL_TRACE) {
        colorLog("addEventListener: event received: " + JSON.stringify(msg));
    }

    switch (msgType) {
        case "queryMemoryBytes":
            const queryBytesResult = cetus.queryMemoryChunk(msgBody.address, 512);

            cetus.sendExtensionMessage("queryMemoryBytesResult", {
                address: msgBody.address,
                value: queryBytesResult,
            });

            break;
        case "queryMemory":
            const queryAddr = msgBody.address;
            const queryMemType = msgBody.memType;

            if (typeof queryAddr !== "number") {
                return;
            }

            const queryResult = cetus.queryMemory(queryAddr, queryMemType);

            cetus.sendExtensionMessage("queryMemoryResult", {
                address: queryAddr,
                value: queryResult,
                memType: queryMemType
            });

            break;
        case "restartSearch":
            cetus.restartSearch();

            break;
        case "search":
            const searchMemType     = msgBody.memType;
            const searchMemAlign    = msgBody.memAlign;
            const searchComparison  = msgBody.compare;
            const searchLower       = msgBody.lower;
            const searchUpper       = msgBody.upper;
            const searchParam       = msgBody.param;

            let searchReturn;
            let searchResults;
            let searchResultsCount;

            if (searchMemType == "ascii" || searchMemType == "utf-8" || searchMemType == "bytes") {
                searchReturn = cetus.patternSearch(searchMemType, searchParam, searchLower, searchUpper);
            }
            else {
                searchReturn = cetus.search(searchComparison,
                                            searchMemType,
                                            searchMemAlign,
                                            searchParam,
                                            searchLower,
                                            searchUpper);
            }

            searchResultsCount = searchReturn.count;
            searchResults = searchReturn.results;

            let subset = {};

            // We do not want to send too many results or we risk crashing the extension
            // If there are more than 100 results, only send 100 but send the real count
            if (searchResultsCount > 100) {
                for (let property in searchResults) {
                    subset[property] = searchResults[property];

                    if (Object.keys(subset).length >= 100) {
                        break;
                    }
                }

                searchResults = subset;
            }

            cetus.sendExtensionMessage("searchResult", {
                count: searchResultsCount,
                results: searchResults,
                memType: searchMemType,
            });

            break;
        // FIXME Upper/lower bounds are not enforced
        case "stringSearch":
            const searchStrType = msgBody.strType;
            const searchStrMinLen = msgBody.minLength;

            let strSearchReturn;

            switch (searchStrType) {
                case "ascii":
                    strSearchReturn = cetus.asciiStrings(searchStrMinLen);
                    break;
                case "utf-8":
                    strSearchReturn = cetus.unicodeStrings(searchStrMinLen);
                    break;
                default:
                    colorError("Got bad string type: " + searchStrType);
                    break;
            }

            let strResultsCount = strSearchReturn.count;
            let strResults = strSearchReturn.results;

            let strSubset = {};

            // We do not want to send too many results or we risk crashing the extension
            // If there are more than 100 results, only send 100 but send the real count
            if (strResultsCount > 100) {
                for (let property in strResults) {
                    strSubset[property] = strResults[property];

                    if (Object.keys(strSubset).length >= 100) {
                        break;
                    }
                }

                strResults = strSubset;
            }

            cetus.sendExtensionMessage("stringSearchResult", {
                count: strResultsCount,
                results: strResults,
            });

            break;
        case "detectTimers":
            const detDuration = parseFloat(msgBody.duration);
            const detStride = parseInt(msgBody.stride);
            const detLower = msgBody.lower;
            const detUpper = msgBody.upper;

            cetus.detectTimers(detDuration, detStride, detLower, detUpper).then(function(res) {
                cetus.sendExtensionMessage("timerDetectResult", {
                    count: res.count,
                    results: res.results
                });
            });

            break;
        case "detectCrypto":
            const cStride = parseInt(msgBody.stride);
            const cLower = msgBody.lower;
            const cUpper = msgBody.upper;

            const cryptoRes = cetus.detectCrypto(cStride, cLower, cUpper);
            cetus.sendExtensionMessage("cryptoDetectResult", {
                count: cryptoRes.count,
                results: cryptoRes.results
            });
            break;
        case "cryptoFindSBoxUsers":
            const sbAddr = parseInt(msgBody.addr);
            const sbWin = parseInt(msgBody.window) || 512;
            const sbMax = parseInt(msgBody.max) || 50;

            if (!Number.isFinite(sbAddr)) {
                cetus.sendExtensionMessage("cryptoSBoxUsersResult", { addr: msgBody.addr, users: [] });
                break;
            }

            const users = cetus.findSBoxUsers(sbAddr, sbWin, sbMax);
            cetus.sendExtensionMessage("cryptoSBoxUsersResult", {
                addr: sbAddr,
                users: users
            });
            break;
        case "cryptoKeyScanAround":
            const kCenter = parseInt(msgBody.center);
            const kRadius = parseInt(msgBody.radius) || 8192;
            const kStride = parseInt(msgBody.stride) || 16;

            if (!Number.isFinite(kCenter)) {
                cetus.sendExtensionMessage("cryptoKeyCandidatesResult", { center: msgBody.center, radius: kRadius, count: 0, results: {} });
                break;
            }

            const nearKeys = cetus.keyScanAround(kCenter, kRadius, kStride);
            cetus.sendExtensionMessage("cryptoKeyCandidatesResult", {
                center: kCenter,
                radius: kRadius,
                count: nearKeys.count,
                results: nearKeys.results
            });
            break;
        case "modifyMemory":
            const modifyAddr = msgBody.memAddr;
            const modifyValue = msgBody.memValue;
            const modifyMemType = msgBody.memType;

            if (bigintIsNaN(modifyAddr) || bigintIsNaN(modifyValue) || !isValidMemType(modifyMemType)) {
                return;
            }

            colorLog("Changing "+modifyAddr+" to "+modifyValue+" ("+modifyMemType+")");

            cetus.modifyMemory(modifyAddr, modifyValue, modifyMemType);

            break;
        case "updateWatch":
            const watchIndex = msgBody.index;
            const watchAddr = msgBody.addr;
            const watchSize = msgBody.size;
            const watchFlags = msgBody.flags;

            const watchValue = msgBody.value;

            if (bigintIsNaN(watchIndex) ||
                bigintIsNaN(watchAddr) ||
                bigintIsNaN(watchSize) ||
                bigintIsNaN(watchFlags)) {
                return;
            }

            if (typeof watchValue.lower === "undefined" || typeof watchValue.upper === "undefined") {
                return;
            }

            if (typeof cetus.watchpointExports[watchIndex] === "undefined") {
                return;
            }

            cetus.watchpointExports[watchIndex](watchAddr, watchValue.lower, watchValue.upper, watchSize, watchFlags);

            break;
        case "queryFunction":
            const funcIndex = msgBody.index;
            const lineNum = msgBody.lineNum;

            const funcBytes = cetus.queryFunction(funcIndex);

            if (typeof funcBytes !== "undefined") {
                cetus.sendExtensionMessage("queryFunctionResult", {
                    funcIndex: funcIndex,
                    bytes: funcBytes,
                    lineNum: lineNum
                });
            }

            break;
        case "shEnable":
            const shMultiplier = msgBody.multiplier;

            if (bigintIsNaN(shMultiplier)) {
                return;
            }

            colorLog("Enabling speedhack at "+shMultiplier+"x");

            cetus.setSpeedhackMultiplier(shMultiplier);

            break;
    }
}, false);

if (typeof cetusInstances === "undefined") {
    cetusInstances = new CetusInstanceContainer();
}
