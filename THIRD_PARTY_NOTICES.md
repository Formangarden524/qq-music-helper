# Third-party notices

The extension contains an **unmodified, separately imported** ES module from `@breezystack/lamejs` version 1.2.7, published under LGPL-3.0. The application itself has not been granted an open-source license; the encoder retains its own license and may be replaced by a compatible implementation.

- Original project: https://github.com/zhuker/lamejs
- Package-declared repository: https://github.com/shijinyu/lamejs
- Exact published package: https://registry.npmjs.org/@breezystack/lamejs/-/lamejs-1.2.7.tgz
- LAME: https://lame.sourceforge.io/
- Unmodified module and original notice: `extension/vendor/`
- Full license texts: `extension/vendor/LGPL-3.0.txt` and `extension/vendor/GPL-3.0.txt`

## Workflow and design origin: cat-catch

This tool grew out of a working QQ Music workflow using **[cat-catch](https://github.com/xifangczy/cat-catch)** by [xifangczy](https://github.com/xifangczy). The original process was to open a shared song link, play it in Chrome, find its audio through cat-catch, download it and rename the file. We gratefully acknowledge cat-catch as the workflow and browser-media-capture inspiration for this project.

This repository independently implements the QQ Music-specific orchestration. No cat-catch source was copied or ported, and cat-catch is not a runtime dependency. No go-music-dl or musicdl source was incorporated either. This design attribution is separate from the bundled lamejs component and its LGPL-3.0 license above.

Corresponding source for this exact npm release: https://github.com/shijinyu/lamejs/tree/1fb0ef5fa177413107e2e107d054a9b994e3f79c

Published package SHA-512 integrity: `sha512-6wc7ck65ctA75Hq7FYHTtTvGnYs6msgdxiSUICQ+A01nVOWg6rqouZB8IdyteRlfpYYiFovkf67dIeOgWIUzTA==`.
