// Root constructors for native screens whose manifest `root_ctor` is not the
// scene the player meets.
//
// `web/assets/native/screens/manifest.json` records the constructor the census
// booted. For pro/stitshop that is 0x8008596c, which is only the BUY tab
// sub-object: booting it standalone traps at pc=0x2cbc (exec outside loaded
// code) and it never draws the shop the player sees. The root scene - greeting
// fade, shop-name/BIT header, BUY/SELL menu - is built by F0x8008c118
// (docs/research/ui/shop-system-decompiled.md). Production
// (web/shop-native.js) and the lab both boot the override from here so a lab
// capture shows the same screen the player gets.

export const NATIVE_ROOT_CTORS = {
    "pro/stitshop": 0x8008c118,
};

export function nativeRootCtorFor(moduleId) {
    return NATIVE_ROOT_CTORS[moduleId];
}
