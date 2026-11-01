import { Router, Request, Response } from 'express';
import logger from '../config/logger.js';
import { mergeStatus } from '../services/merge/index.js';
import { MergeError, mergePairs } from '../services/merge/pairs.js';

const router = Router();

// A known refusal (MergeError) with its status; anything else is logged, with a fixed message
const fail = (res: Response, error: unknown, what: string) => {
  if (error instanceof MergeError) {
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

// GET the choice settings: a fixed value, or "ask" each time
router.get('/settings', async (req: Request, res: Response) => {
  try {
    res.json({ choices: await mergePairs.getChoiceSettings() });
  } catch (error) {
    fail(res, error, 'read the merge settings');
  }
});

router.put('/settings', async (req: Request, res: Response) => {
  try {
    const choices = req.body?.choices;
    if (!choices || typeof choices !== 'object' || Array.isArray(choices)) {
      res.status(400).json({ error: 'choices must be an object' });
      return;
    }
    res.json({ choices: await mergePairs.setChoiceSettings(choices) });
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

// GET the full analyze report, as Dyadrr wrote it
router.get('/pairs/:id/report', async (req: Request, res: Response) => {
  try {
    const report = await mergePairs.report(req.params.id);
    if (!report) {
      res.status(404).json({ error: 'No report yet' });
      return;
    }
    res.json(report);
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

export default router;
