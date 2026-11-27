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
  ['Interstellar.2014.1080p.BluRay.x264-GRP.part01.rar', 'Interstellar', 2014],
  ['Interstellar.2014.COMPLETE.BLURAY-GRP.rar', 'Interstellar', 2014],
  ['The.Matrix.1999.1080p.BluRay.x264-GRP.mkv', 'The Matrix', 1999],
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
  ['Il Padrino -1972-', 'Il Padrino', 1972],
  ['Class of 1999, The', 'Class of 1999, The', null],
  ['Movie Cut!', 'Movie Cut!', null],
  ['(500).Days.of.Summer.2009.BluRay', '500 Days of Summer', 2009],
  ['Ma.che.bella.sorpresa!.2015.BluRay', 'Ma che bella sorpresa!', 2015],
  ['The Italian - 2005', 'The Italian', 2005],
  ['Johnny English - ITA - 2003', 'Johnny English', 2003],
  ['Godzilla 2000: Millennium BluRay', 'Godzilla 2000: Millennium', null],
  ['Ciao.2020!.BluRay', 'Ciao 2020!', null],
];

for (const [input, title, year] of cases) {
  test(`parseReleaseName: ${input}`, () => {
    const { title: parsedTitle, year: parsedYear } = parseReleaseName(input);
    assert.deepEqual({ title: parsedTitle, year: parsedYear }, { title, year });
  });
}

// The version (edition) after the title, as the release name's versions (issue #108)
const editions: [string, string | null][] = [
  ['Orbita.Silenziosa.2010.Extended.Cut.2160p.UHD.BluRay-XYZ', 'Extended'],
  ['Orbita Silenziosa (Director’s Cut) (2010)', "Director's Cut"],
  ['Orbita.Silenziosa.2010.DIRECTORS.CUT.1080p.BluRay', "Director's Cut"],
  ['Orbita.Silenziosa.2010.Extended.Directors.Cut.1080p', "Director's Cut"],
  ['Orbita.Silenziosa.2010.Theatrical.Cut.2160p.WEB-DL', 'Theatrical'],
  ['Orbita.Silenziosa.2010.UNRATED.1080p.BluRay', 'Unrated'],
  ['Orbita.Silenziosa.2010.25th.Anniversary.Edition.BluRay', 'Anniversary Edition'],
  ['Orbita.Silenziosa.2010.IMAX.2160p', 'IMAX'],
  ['Orbita.Silenziosa.2010.REMASTERED.1080p', 'Remastered'],
  ['Orbita Silenziosa - Extended - ITA (2010)', 'Extended'],
  ['Orbita.Silenziosa.2010.1080p.BluRay.ITA-ABC', null],
  // An edition word in the title is not a version
  ['The.Final.Cut.2004.1080p.BluRay', null],
  ['Uncut.Gems.2019.1080p.BluRay', null],
  ['Movie Cut!', null],
];

for (const [input, version] of editions) {
  test(`parseReleaseName version: ${input}`, () => {
    assert.equal(parseReleaseName(input).version, version);
  });
}

test('parseDiscLabel: upper case with underscores and a disc number', () => {
  assert.deepEqual(parseDiscLabel('THE_MATRIX_DISC1'), { title: 'The Matrix', year: null, version: null });
  assert.deepEqual(parseDiscLabel('IL_PADRINO'), { title: 'Il Padrino', year: null, version: null });
});
