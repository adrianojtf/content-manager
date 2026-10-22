import common from './es-ES/common.mjs';
import settings from './es-ES/settings.mjs';
import comments from './es-ES/comments.mjs';
import errors from './es-ES/errors.mjs';

export default Object.freeze({ ...common, ...settings, ...comments, ...errors });
