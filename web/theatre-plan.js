// web/theatre-plan.js — what the Move Theatre page offers for one Digimon.
//
// Pure data, no DOM: the page asks for a species and gets back the model folder that
// draws it, the two techniques the species itself owns (its basic and its signature
// columns in digimon.json, when the fight table can actually play them) and the name
// reported as missing when the battle library has no model for it. The page never
// invents a technique or a model: everything here comes from the shipped tables.
//
// The camera modes are the disc's own battle views — the same four the Battle Lab's
// select offers, and the same names web/battle3d.js setCameraMode accepts.

export const THEATRE_CAMERA_MODES = ["director", "game", "behind", "orbit"];

/** The four battle camera modes the theatre offers, in the disc's order. */
export function theatreCameraModes() {
    return [...THEATRE_CAMERA_MODES];
}

/**
 * What the theatre may play for `name`.
 *
 * @param {{digimon: {digimon: Array}, modelMap: Object, models: string[], techTable: Object}} data
 * @param {string} name  the species name as digimon.json spells it
 * @returns {{name: string, model: string|null, techs: number[], missing: string[]}}
 *   techs = the species' non-zero tech_basic / tech_signature that the fight table carries,
 *   sorted and deduped; missing = [name] when no model folder exists for it.
 */
export function theatrePlan({ digimon, modelMap, models, techTable }, name) {
    // digimon is digimon.json itself ({ digimon: [...], skills: [...] }); accept the bare
    // species array too so the caller does not have to unwrap it.
    const speciesList = Array.isArray(digimon) ? digimon : (digimon?.digimon ?? []);
    const species = speciesList.find((d) => d?.name === name) ?? null;
    const techs = [];
    if (species) {
        for (const column of [species.tech_basic, species.tech_signature]) {
            const id = Number(column) | 0;
            if (id !== 0 && techTable?.[String(id)] && !techs.includes(id)) techs.push(id);
        }
    }
    techs.sort((a, b) => a - b);
    const folder = modelMap?.[name] ?? null;
    const model = folder && Array.isArray(models) && models.includes(folder) ? folder : null;
    return { name, model, techs, missing: model ? [] : [name] };
}
