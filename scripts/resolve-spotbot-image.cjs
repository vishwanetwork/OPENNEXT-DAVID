'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Keep builds reproducible: accept only a published bot commit tag or image digest. */
function resolveImage(dockerfile, override = '') {
  const image = override || /^ARG SPOTBOT_IMAGE=(.+)$/m.exec(dockerfile)?.[1];
  if (!image || !/^ghcr\.io\/vishwanetwork\/spot-order-bot(?::[a-f0-9]{40}|@sha256:[a-f0-9]{64})$/.test(image)) {
    throw new Error('SPOTBOT_IMAGE must pin a full commit SHA or sha256 digest');
  }
  return image;
}

module.exports = { resolveImage };
if (require.main === module) {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
  console.log('image=' + resolveImage(dockerfile, process.env.SPOTBOT_IMAGE_OVERRIDE));
}
