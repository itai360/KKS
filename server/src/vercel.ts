// Vercel function entry (bundled by scripts/vercel-output.mjs).
import './vercelEnv'; // first: the configuration reads the environment on import
import { handler } from './cloud';

export default handler;
