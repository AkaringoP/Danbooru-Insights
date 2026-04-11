// ESLint v9 flat config — composes the gts (Google TypeScript Style)
// rules manually because gts@7.0.0's bundled `eslint.config.js` has a
// broken path (`./src/index.js` instead of `./build/src/index.js`).
//
// Once gts ships a fix, this can be reduced to:
//   import gtsConfig from 'gts/eslint.config.js';
//   export default gtsConfig;
import {defineConfig} from 'eslint/config';
import gtsRules from 'gts/build/src/index.js';
import gtsIgnores from 'gts/eslint.ignores.js';

export default defineConfig([
  {ignores: [...gtsIgnores, 'dist/']},
  ...gtsRules,
]);
