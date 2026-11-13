// web/map-open-air.js -- the game one open-air / indoor split by map name. Pure (no DOM); ambience.js and world-globe use it.
export const OPEN_AIR = [
    /^Central Sector — (Asuka City|Amaterasu City|Asuka Bridge|Amaterasu Bridge|Central Park|Wire Forest Entrance|Shell Beach|Plug Cape)/,
    /^East Sector — (West Wire Forest|East Wire Forest|Protocol Forest|Divermon's Lake|Duel Island|Wind Prairie|Kicking Forest|Seiryu City|Qing Long City)/,
    /^South Sector — (Bulk Swamp|Bulk Bridge|Bios Swamp|Tranquil Swamp|Jungle Grave|Phoenix Bay|Ether Jungle|South Cape|Suzaku City|Zhu Que City)/,
    /^West Sector — (Pelche Oasis|Bullet Valley|Byakko City|Bai Hu City)/,
    /^North Sector — (Boot Mountain|Genbu City|Xuan Wu City)/,
    /^Kusanagi City — Street Corner/,
];
export const SNOWY = [
    /^North Sector — (Snow Mountain|Freeze Mountain|Lake of Ice|Battle Gate)/,
    /^East Sector — Tyranno Valley/,
];
// Dry places get a sandstorm instead of rain.
export const SANDY = [
    /^West Sector — (Pelche Oasis|Bullet Valley|South Badland|North Badland W|North Badland E|Noise Desert|S Noise Desert|Mobius Desert)/,
];
/** Open air by the map name (snow and sand places count as open air). Everything else is indoor. */
export function isOpenAirMapName(name) {
    return SNOWY.some((r) => r.test(name)) || SANDY.some((r) => r.test(name)) || OPEN_AIR.some((r) => r.test(name));
}
