import { readHandlers } from './read.js';
import { answerHandlers } from './answer.js';
import { observeHandlers } from './observe.js';

export const inboxHandlers = [...readHandlers, ...answerHandlers, ...observeHandlers];
