import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const remoteDir = path.resolve('test-repos/remotes/VRHK-16903.git')
fs.mkdirSync(remoteDir, { recursive: true })
try {
  execSync('git init --bare', { cwd: remoteDir })
} catch (e) {}

const targetRepo = path.resolve('test-repos/dev/56ID/20260924/liuxing/VRHK-16903-SI-HAL-SNKO-添加字段')
try {
  execSync('git remote remove origin', { cwd: targetRepo })
} catch {}
const normalizedRemote = remoteDir.replace(/\\/g, '/')
execSync(`git remote add origin "${normalizedRemote}"`, { cwd: targetRepo })
execSync('git push -u origin main', { cwd: targetRepo })
console.log('Remote initialized and pushed main!')
