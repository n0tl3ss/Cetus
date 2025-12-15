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

// Small helpers to avoid null deref when a tab doesn't exist on a given page
const setDisplay = function(id, show) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? 'block' : 'none';
};

const setActive = function(id, active) {
    const el = document.getElementById(id);
    if (el) el.className = active ? 'tabs-item is-active' : 'tabs-item';
};

// Navigation logic
const changeTab = function(id) {
    // Ensure Timestamps is hidden/inactive by default so legacy cases don't leave it visible
    setDisplay('tabTimestamps', false);
    setActive('liTabTimestamps', false);

    switch (id) {
        case "tabSearchButton":
            setDisplay('tabSearch', true);
            setDisplay('tabStrings', false);
            setDisplay('tabPatch', false);
            setDisplay('tabSpeedHack', false);
            setDisplay('tabBookmarks', false);
            setDisplay('tabMemView', false);
            setDisplay('tabTimers', false);
            setDisplay('tabCrypto', false);
            setDisplay('tabDiff', false);

            setActive('liTabSearch', true);
            setActive('liTabStrings', false);
            setActive('liTabPatch', false);
            setActive('liTabSpeedHack', false);
            setActive('liTabBookmarks', false);
            setActive('liTabMemView', false);
            setActive('liTabTimers', false);
            setActive('liTabCrypto', false);
            setActive('liTabDiff', false);

            break;

        case "tabStringsButton":
            setDisplay('tabSearch', false);
            setDisplay('tabStrings', true);
            setDisplay('tabPatch', false);
            setDisplay('tabSpeedHack', false);
            setDisplay('tabBookmarks', false);
            setDisplay('tabMemView', false);
            setDisplay('tabTimers', false);
            setDisplay('tabCrypto', false);
            setDisplay('tabDiff', false);

            setActive('liTabSearch', false);
            setActive('liTabStrings', true);
            setActive('liTabPatch', false);
            setActive('liTabSpeedHack', false);
            setActive('liTabBookmarks', false);
            setActive('liTabMemView', false);
            setActive('liTabTimers', false);
            setActive('liTabCrypto', false);
            setActive('liTabDiff', false);

            break;

        case "tabPatchButton":
            setDisplay('tabSearch', false);
            setDisplay('tabStrings', false);
            setDisplay('tabPatch', true);
            setDisplay('tabSpeedHack', false);
            setDisplay('tabBookmarks', false);
            setDisplay('tabMemView', false);
            setDisplay('tabTimers', false);
            setDisplay('tabCrypto', false);
            setDisplay('tabDiff', false);

            setActive('liTabSearch', false);
            setActive('liTabStrings', false);
            setActive('liTabPatch', true);
            setActive('liTabSpeedHack', false);
            setActive('liTabBookmarks', false);
            setActive('liTabMemView', false);
            setActive('liTabTimers', false);
            setActive('liTabCrypto', false);
            setActive('liTabDiff', false);

            break;

        case "tabSpeedHackButton":
            setDisplay('tabSearch', false);
            setDisplay('tabStrings', false);
            setDisplay('tabPatch', false);
            setDisplay('tabSpeedHack', true);
            setDisplay('tabBookmarks', false);
            setDisplay('tabMemView', false);
            setDisplay('tabTimers', false);
            setDisplay('tabCrypto', false);
            setDisplay('tabDiff', false);

            setActive('liTabSearch', false);
            setActive('liTabStrings', false);
            setActive('liTabPatch', false);
            setActive('liTabSpeedHack', true);
            setActive('liTabBookmarks', false);
            setActive('liTabMemView', false);
            setActive('liTabTimers', false);
            setActive('liTabCrypto', false);
            setActive('liTabDiff', false);

            break;

        case "tabBookmarksButton":
            setDisplay('tabSearch', false);
            setDisplay('tabStrings', false);
            setDisplay('tabPatch', false);
            setDisplay('tabSpeedHack', false);
            setDisplay('tabBookmarks', true);
            setDisplay('tabMemView', false);
            setDisplay('tabTimers', false);
            setDisplay('tabCrypto', false);
            setDisplay('tabDiff', false);

            setActive('liTabSearch', false);
            setActive('liTabStrings', false);
            setActive('liTabPatch', false);
            setActive('liTabSpeedHack', false);
            setActive('liTabBookmarks', true);
            setActive('liTabMemView', false);
            setActive('liTabTimers', false);
            setActive('liTabCrypto', false);
            setActive('liTabDiff', false);

            break;

        case "tabTimersButton":
            setDisplay('tabSearch', false);
            setDisplay('tabStrings', false);
            setDisplay('tabPatch', false);
            setDisplay('tabSpeedHack', false);
            setDisplay('tabBookmarks', false);
            setDisplay('tabMemView', false);
            setDisplay('tabTimers', true);
            setDisplay('tabCrypto', false);
            setDisplay('tabDiff', false);

            setActive('liTabSearch', false);
            setActive('liTabStrings', false);
            setActive('liTabPatch', false);
            setActive('liTabSpeedHack', false);
            setActive('liTabBookmarks', false);
            setActive('liTabMemView', false);
            setActive('liTabTimers', true);
            setActive('liTabCrypto', false);
            setActive('liTabDiff', false);

            break;

        case "tabTimestampsButton":
            setDisplay('tabSearch', false);
            setDisplay('tabStrings', false);
            setDisplay('tabPatch', false);
            setDisplay('tabSpeedHack', false);
            setDisplay('tabBookmarks', false);
            setDisplay('tabMemView', false);
            setDisplay('tabTimers', false);
            setDisplay('tabCrypto', false);
            setDisplay('tabDiff', false);
            setDisplay('tabTimestamps', true);

            setActive('liTabSearch', false);
            setActive('liTabStrings', false);
            setActive('liTabPatch', false);
            setActive('liTabSpeedHack', false);
            setActive('liTabBookmarks', false);
            setActive('liTabMemView', false);
            setActive('liTabTimers', false);
            setActive('liTabCrypto', false);
            setActive('liTabDiff', false);
            setActive('liTabTimestamps', true);

            break;

        case "tabCryptoButton":
            setDisplay('tabSearch', false);
            setDisplay('tabStrings', false);
            setDisplay('tabPatch', false);
            setDisplay('tabSpeedHack', false);
            setDisplay('tabBookmarks', false);
            setDisplay('tabMemView', false);
            setDisplay('tabTimers', false);
            setDisplay('tabCrypto', true);
            setDisplay('tabDiff', false);

            setActive('liTabSearch', false);
            setActive('liTabStrings', false);
            setActive('liTabPatch', false);
            setActive('liTabSpeedHack', false);
            setActive('liTabBookmarks', false);
            setActive('liTabMemView', false);
            setActive('liTabTimers', false);
            setActive('liTabCrypto', true);
            setActive('liTabDiff', false);

            break;

        case "tabDiffButton":
            setDisplay('tabSearch', false);
            setDisplay('tabStrings', false);
            setDisplay('tabPatch', false);
            setDisplay('tabSpeedHack', false);
            setDisplay('tabBookmarks', false);
            setDisplay('tabMemView', false);
            setDisplay('tabTimers', false);
            setDisplay('tabCrypto', false);
            setDisplay('tabDiff', true);

            setActive('liTabSearch', false);
            setActive('liTabStrings', false);
            setActive('liTabPatch', false);
            setActive('liTabSpeedHack', false);
            setActive('liTabBookmarks', false);
            setActive('liTabMemView', false);
            setActive('liTabTimers', false);
            setActive('liTabCrypto', false);
            setActive('liTabDiff', true);

            break;

        case "tabMemViewButton":
            setDisplay('tabSearch', false);
            setDisplay('tabStrings', false);
            setDisplay('tabPatch', false);
            setDisplay('tabSpeedHack', false);
            setDisplay('tabBookmarks', false);
            setDisplay('tabMemView', true);
            setDisplay('tabTimers', false);
            setDisplay('tabCrypto', false);
            setDisplay('tabDiff', false);

            setActive('liTabSearch', false);
            setActive('liTabStrings', false);
            setActive('liTabPatch', false);
            setActive('liTabSpeedHack', false);
            setActive('liTabBookmarks', false);
            setActive('liTabMemView', true);
            setActive('liTabTimers', false);
            setActive('liTabCrypto', false);
            setActive('liTabDiff', false);

            break;

        default:
            throw new Error("Bad tab ID " + id);
    }
};

const buttons = document.getElementsByName('tabButton');

for (let i = 0; i < buttons.length; i++) {
	buttons[i].onclick = function(e) {
		e.preventDefault();

		const id = e.target.id;

		changeTab(id);
	};
}
