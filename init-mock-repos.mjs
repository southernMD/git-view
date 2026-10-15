import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const baseDir = path.resolve('test-repos')

const repos = [
  'dev/56ID/20260924/liuxing/VRHK-16903-SI-HAL-SNKO-添加字段',
  'dev/56ID/20260924/liuxing/VRHK-16904-SI-HAL-SNKO-修复缺陷',
  'dev/56ID/20261010/zhangsan/VRHK-17001-TEST'
]

for (const repoRel of repos) {
  const fullPath = path.join(baseDir, ...repoRel.split('/'))
  fs.mkdirSync(fullPath, { recursive: true })
  
  const exec = (cmd) => execSync(cmd, { cwd: fullPath, stdio: 'pipe' })
  
  try {
    exec('git init')
    exec('git config user.name "Liu Xing"')
    exec('git config user.email "liuxing@example.com"')
    fs.writeFileSync(path.join(fullPath, 'README.md'), `# ${path.basename(fullPath)}\n\nRepository for ${repoRel}`)
    exec('git add README.md')
    exec('git commit -m "feat: 初始提交"')
    exec('git branch -M main')
    
    // add branches
    exec('git checkout -b dev/feature-v1')
    fs.writeFileSync(path.join(fullPath, 'feature.txt'), 'feature content')
    exec('git add feature.txt')
    exec('git commit -m "feat: 实现核心业务功能"')
    
    exec('git checkout -b feature/HAL-patch')
    fs.writeFileSync(path.join(fullPath, 'patch.txt'), 'patch data')
    exec('git add patch.txt')
    exec('git commit -m "fix: 临时修复补丁"')
    
    exec('git checkout main')
    console.log(`Created repo: ${fullPath}`)
  } catch (err) {
    console.error(`Error creating repo ${fullPath}:`, err.message)
  }
}
