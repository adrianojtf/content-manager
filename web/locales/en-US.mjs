import common from './en-US/common.mjs';
import settings from './en-US/settings.mjs';
import comments from './en-US/comments.mjs';
import errors from './en-US/errors.mjs';

export default Object.freeze({ ...common, ...settings, ...comments, ...errors });
