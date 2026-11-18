import { app } from '../server/app.js';
import { waitUntil } from '@vercel/functions';

// Keep notification work alive after the HTTP response on Vercel.
app.locals.deferSubmission = waitUntil;

export default app;
