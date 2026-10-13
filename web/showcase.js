// The top-bar "Showcase" menu: hand-picked maps, each with its own time of day and weather, so
// one click gives a good-looking scene to record. "Tour" walks through all of them.
// tod: auto|day|golden|dusk|night   mode: clear|always (rain/snow/sand that suits the map)|storm
export const SCENES = [
    { id: "s330", name: "Central Park — golden hour", tod: "golden", mode: "clear" },
    { id: "s330", name: "Central Park — cozy rain", tod: "dusk", mode: "always" },
    { id: "s350", name: "West Wire Forest — misty light", tod: "golden", mode: "clear" },
    { id: "s400", name: "Kicking Forest — sunbeams", tod: "day", mode: "clear" },
    { id: "s380", name: "Divermon's Lake — golden water", tod: "golden", mode: "clear" },
    { id: "s340", name: "Shell Beach — starlit night", tod: "night", mode: "clear" },
    { id: "s345", name: "Plug Cape — moonlit cape", tod: "night", mode: "clear" },
    { id: "s485", name: "Phoenix Bay — rainy swamp", tod: "dusk", mode: "always" },
    { id: "s490", name: "Ether Jungle — jungle mist", tod: "golden", mode: "clear" },
    { id: "s480", name: "Jungle Grave — fog and shafts", tod: "day", mode: "clear" },
    { id: "s465", name: "Tranquil Swamp — dusk fog", tod: "dusk", mode: "clear" },
    { id: "s695", name: "Snow Mountain — snowfall", tod: "day", mode: "always" },
    { id: "s705", name: "Freeze Mountain — blizzard", tod: "day", mode: "storm" },
    { id: "s715", name: "Lake of Ice — frozen sparkle", tod: "golden", mode: "clear" },
    { id: "s635", name: "Mobius Desert — sandstorm", tod: "day", mode: "storm" },
    { id: "s560", name: "Pelche Oasis — oasis sunset", tod: "golden", mode: "clear" },
    { id: "s395", name: "Wind Prairie — windswept gold", tod: "golden", mode: "clear" },
    { id: "s495", name: "South Cape — evening shore", tod: "dusk", mode: "clear" },
    { id: "s420", name: "Seiryu City — golden city", tod: "golden", mode: "clear" },
    { id: "s500", name: "Suzaku City — lantern night", tod: "night", mode: "clear" },
    { id: "s780", name: "Kusanagi Street — neon night", tod: "night", mode: "clear" },
    { id: "s200", name: "Asuka City — night lights", tod: "night", mode: "clear" },
    { id: "s525", name: "Suzaku UG Lake — crystal cave", tod: "day", mode: "clear" },
];
const TOUR_SECONDS = 25;

// hooks: { select, goTo(mapId), apply(scene) }
export function installShowcase(h) {
    const sel = h.select;
    sel.add(new Option("— pick a scene —", ""));
    SCENES.forEach((s, i) => sel.add(new Option(s.name, String(i))));
    sel.add(new Option("▶ Tour all scenes", "tour"));
    let timer = 0, tourIdx = 0;
    const show = (i) => { const s = SCENES[i]; h.apply(s); h.goTo(s.id); };
    const stop = () => { clearInterval(timer); timer = 0; };
    sel.onchange = () => {
        stop();
        if (sel.value === "tour") {
            tourIdx = 0; show(0);
            timer = setInterval(() => { tourIdx = (tourIdx + 1) % SCENES.length; show(tourIdx); }, TOUR_SECONDS * 1000);
        } else if (sel.value !== "") show(+sel.value);
        sel.blur();
    };
    window.__showcase = { scenes: SCENES, show, stop };
}
