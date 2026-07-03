/** The feedback store singleton, backed by userData. */
import { join } from 'node:path';
import { app } from 'electron';
import { createFeedbackStore } from './feedbackService';

export const feedbackStore = createFeedbackStore({
  filePath: join(app.getPath('userData'), 'feedback.json'),
});
