import { Router, Request, Response } from 'express';
import logger from '../config/logger.js';
import { mergeStatus } from '../services/merge/index.js';
import { MergeError, mergePairs, OutputExistsError } from '../services/merge/pairs.js';
import { HoldError, manualHolds } from '../services/merge/manual.js';
import { mergePlans } from '../services/merge/plans.js';

const router = Router();

// A known refusal (MergeError) with its status; anything else is logged, with a fixed message
const fail = (res: Response, error: unknown, what: string) => {
  // A file with the merged file's name is there: the GUI asks whether to replace it
  if (error instanceof OutputExistsError) {
    res.status(409).json({
      error: error.message,
      code: 'OUTPUT_EXISTS',
      fileName: error.fileName,
      existsLocally: error.existsLocally,
      existsOnServer: error.existsOnServer,
    });
    return;
  }
  if (error instanceof MergeError || error instanceof HoldError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error(error, `Failed to ${what}`);
  res.status(500).json({ error: `Failed to ${what}` });
};

// GET whether merging is on, and whether the Dyadrr container is running
router.get('/', async (req: Request, res: Response) => {
  try {
    res.json({ status: await mergeStatus() });
  } catch (error) {
    fail(res, error, 'read the merge status');
  }
});

const settings = async () => ({
  choices: await mergePairs.getChoiceSettings(),
  inputs: await mergePairs.getInputsAfter(),
  holdAll: await manualHolds.getHoldAll(),
});

// GET the settings: the choices (a fixed value, or "ask" each time), the inputs after a merge,
// and "Hold every new file"
router.get('/settings', async (req: Request, res: Response) => {
  try {
    res.json(await settings());
  } catch (error) {
    fail(res, error, 'read the merge settings');
  }
});

router.put('/settings', async (req: Request, res: Response) => {
  try {
    const { choices, inputs, holdAll } = req.body ?? {};
    if (choices !== undefined && (!choices || typeof choices !== 'object' || Array.isArray(choices))) {
      res.status(400).json({ error: 'choices must be an object' });
      return;
    }
    if (inputs !== undefined) await mergePairs.setInputsAfter(inputs);
    if (holdAll !== undefined) await manualHolds.setHoldAll(holdAll);
    if (choices !== undefined) await mergePairs.setChoiceSettings(choices);
    res.json(await settings());
  } catch (error) {
    fail(res, error, 'save the merge settings');
  }
});

// GET the files that can be paired: on the disk, not uploading, not in a pair being analyzed
router.get('/candidates', async (req: Request, res: Response) => {
  try {
    res.json(await mergePairs.candidates());
  } catch (error) {
    fail(res, error, 'list the files to pair');
  }
});

router.get('/pairs', async (req: Request, res: Response) => {
  try {
    res.json(await mergePairs.list());
  } catch (error) {
    fail(res, error, 'list the merge pairs');
  }
});

// POST pair two files and analyze them: { uploadIds: [a, b], originalLanguage? }
router.post('/pairs', async (req: Request, res: Response) => {
  try {
    res.status(201).json(await mergePairs.create(req.body?.uploadIds, req.body?.originalLanguage));
  } catch (error) {
    fail(res, error, 'pair the files');
  }
});

router.get('/pairs/:id', async (req: Request, res: Response) => {
  try {
    res.json(await mergePairs.get(req.params.id));
  } catch (error) {
    fail(res, error, 'read the merge pair');
  }
});

// A report as a file to save (?download=1), or as JSON to read
const sendReport = (req: Request, res: Response, report: unknown, name: string) => {
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="dyadrr-${name}-${req.params.id}.json"`);
    res.type('application/json').send(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  res.json(report);
};

// GET the full analyze report, as Dyadrr wrote it (?download=1: as a file)
router.get('/pairs/:id/report', async (req: Request, res: Response) => {
  try {
    const report = await mergePairs.report(req.params.id);
    if (!report) {
      res.status(404).json({ error: 'No report yet' });
      return;
    }
    sendReport(req, res, report, 'analyze');
  } catch (error) {
    fail(res, error, 'read the analysis report');
  }
});

// POST analyze again (another original language with { originalLanguage })
router.post('/pairs/:id/analyze', async (req: Request, res: Response) => {
  try {
    res.json(await mergePairs.analyze(req.params.id, req.body?.originalLanguage));
  } catch (error) {
    fail(res, error, 'analyze the pair');
  }
});

// GET the merged file's default name, and whether a file with that name is already there (?name= to check another)
router.get('/pairs/:id/merge-preview', async (req: Request, res: Response) => {
  try {
    res.json(await mergePairs.mergePreview(req.params.id, req.query.name));
  } catch (error) {
    fail(res, error, 'prepare the merge');
  }
});

// POST merge an eligible pair: { choices: { edgeMismatch: "drop" }, outputName?, replaceExisting? }
router.post('/pairs/:id/merge', async (req: Request, res: Response) => {
  try {
    res.json(await mergePairs.merge(req.params.id, req.body ?? {}));
  } catch (error) {
    fail(res, error, 'merge the pair');
  }
});

// GET the merge's full report, as Dyadrr wrote it (?download=1: as a file)
router.get('/pairs/:id/merge-report', async (req: Request, res: Response) => {
  try {
    const report = await mergePairs.mergeReport(req.params.id);
    if (!report) {
      res.status(404).json({ error: 'No merge report yet' });
      return;
    }
    sendReport(req, res, report, 'merge');
  } catch (error) {
    fail(res, error, 'read the merge report');
  }
});

router.post('/pairs/:id/cancel', async (req: Request, res: Response) => {
  try {
    res.json(await mergePairs.cancel(req.params.id));
  } catch (error) {
    fail(res, error, 'stop the analysis');
  }
});

router.delete('/pairs/:id', async (req: Request, res: Response) => {
  try {
    await mergePairs.remove(req.params.id);
    res.status(204).end();
  } catch (error) {
    fail(res, error, 'remove the pair');
  }
});

// Pairs planned before their files arrive (services/merge/plans.ts): by hand, or by bookrr
// when it sends the two torrents

// GET what a pair can be planned with: rips not finished, torrents of the clients, files not uploaded
router.get('/plans/candidates', async (req: Request, res: Response) => {
  try {
    res.json(await mergePlans.candidates());
  } catch (error) {
    fail(res, error, 'list what a pair can be planned with');
  }
});

router.get('/plans', async (req: Request, res: Response) => {
  try {
    res.json(await mergePlans.list());
  } catch (error) {
    fail(res, error, 'list the planned pairs');
  }
});

// POST plan a pair: { files: [{ infoHash?, name?, ripId?, uploadId?, label? }, {...}], tmdbId?, originalLanguage?, origin? }
router.post('/plans', async (req: Request, res: Response) => {
  try {
    const { created, plan } = await mergePlans.create(req.body ?? {});
    res.status(created ? 201 : 200).json(plan);
  } catch (error) {
    fail(res, error, 'plan the pair');
  }
});

router.get('/plans/:id', async (req: Request, res: Response) => {
  try {
    res.json(await mergePlans.get(req.params.id));
  } catch (error) {
    fail(res, error, 'read the planned pair');
  }
});

// POST create the pair again, after an error, once both files are there
router.post('/plans/:id/pair', async (req: Request, res: Response) => {
  try {
    res.json(await mergePlans.pair(req.params.id));
  } catch (error) {
    fail(res, error, 'create the planned pair');
  }
});

// DELETE forget a planned pair: its files already held stay held
router.delete('/plans/:id', async (req: Request, res: Response) => {
  try {
    await mergePlans.remove(req.params.id);
    res.status(204).end();
  } catch (error) {
    fail(res, error, 'remove the planned pair');
  }
});

export default router;
