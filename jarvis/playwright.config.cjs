'use strict';
const fs=require('node:fs');
module.exports={testDir:'./desktop',testMatch:'**/*.spec.cjs',timeout:20000,reporter:'list',use:{headless:true,launchOptions:{executablePath:process.env.JARVIS_BROWSER||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']}}};
