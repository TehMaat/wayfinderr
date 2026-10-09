import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscLabel, parseReleaseName } from './releaseName.js';

const cases: [string, string, number | null][] = [
  ['The.Matrix.1999.1080p.BluRay.ISO', 'The Matrix', 1999],
  ['Il.Padrino.1972.BDMV.ITA.ENG', 'Il Padrino', 1972],
  ['La.vita.e.bella.1997.1080p.BluRay.AVC.DTS-HD.MA.5.1-GRP', 'La vita e bella', 1997],
  ['Amélie (2001) [BDISO]', 'Amélie', 2001],
  ['1917.2019.2160p.UHD.BluRay.REMUX.HDR.HEVC.Atmos', '1917', 2019],
  ['2001.A.Space.Odyssey.1968.2160p.UHD.BluRay', '2001 A Space Odyssey', 1968],
  ['Blade.Runner.2049.2017.COMPLETE.UHD.BLURAY-GROUP', 'Blade Runner 2049', 2017],
  ['Movie.Name.2019.COMPLETE.BLURAY-GROUP', 'Movie Name', 2019],
  ['Dune.Part.Two.2024.ITA.ENG.2160p.UHD.BluRay.REMUX', 'Dune Part Two', 2024],
  ['The.Full.Monty.1997.DVD9.PAL', 'The Full Monty', 1997],
  ['A.Complete.Unknown.2024.BluRay.1080p', 'A Complete Unknown', 2024],
  ['Up.2009.BDISO', 'Up', 2009],
  ['Inception 2010 1080p BluRay x264', 'Inception', 2010],
  ['Nuovo_Cinema_Paradiso_1988_DVD9', 'Nuovo Cinema Paradiso', 1988],
  ['movie.iso', 'movie', null],
  ['The Godfather Part II ITA ENG BluRay', 'The Godfather Part II', null],
  ['Interstellar.2014.iso', 'Interstellar', 2014],
  ['[site.org] Parasite.2019.BluRay.1080p', 'Parasite', 2019],
  ['Bridget.Jones.Baby.2016.1080p.BluRay.AVC.DTS-HD.MA.5.1-GRP', 'Bridget Jones Baby', 2016],
  ["Bridget Jones's Baby (2016) [BDMV]", "Bridget Jones's Baby", 2016],
  ['Il Padrino [ITA-ENG] (1972)', 'Il Padrino', 1972],
  ['Il Padrino ITA/ENG BluRay', 'Il Padrino', null],
  ['Il Padrino [SUB-ITA] [iTALiAN-ENGLiSH] (1972)', 'Il Padrino', 1972],
  ['Movie Name -ITA- (2019)', 'Movie Name', 2019],
  ['Il Padrino (Director’s Cut) (1972)', 'Il Padrino', 1972],
  ['Il Padrino - Extended - ITA (1972)', 'Il Padrino', 1972],
  ['Fantozzi – Il ritorno – (1996)', 'Fantozzi – Il ritorno', 1996],
  ['Il Padrino(1972)[BDRip]', 'Il Padrino', 1972],
  ['Il Padrino (1972, Coppola) [BDRip]', 'Il Padrino', 1972],
  ['(500).Days.of.Summer.2009.BluRay', '500 Days of Summer', 2009],
  ['Ma.che.bella.sorpresa!.2015.BluRay', 'Ma che bella sorpresa!', 2015],
];

for (const [input, title, year] of cases) {
  test(`parseReleaseName: ${input}`, () => {
    assert.deepEqual(parseReleaseName(input), { title, year });
  });
}

test('parseDiscLabel: upper case with underscores and a disc number', () => {
  assert.deepEqual(parseDiscLabel('THE_MATRIX_DISC1'), { title: 'The Matrix', year: null });
  assert.deepEqual(parseDiscLabel('IL_PADRINO'), { title: 'Il Padrino', year: null });
});
