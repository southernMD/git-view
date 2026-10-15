import type { RepoDetails } from '../api'

export interface TreeNode {
  id: string
  name: string
  folderPath: string
  isFolder: boolean
  children: TreeNode[]
  repo?: RepoDetails
  repoCount: number
}

// Build hierarchical folder/repo tree from list of repos
export function buildRepoTree(repos: RepoDetails[]): TreeNode {
  const root: TreeNode = {
    id: 'root',
    name: '全部路径',
    folderPath: '',
    isFolder: true,
    children: [],
    repoCount: 0
  }

  for (const repo of repos) {
    const rawPath = repo.path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const segments = rawPath.split('/').filter(Boolean)

    if (segments.length === 0) continue

    let currentNode = root
    let accumulatedPath = ''

    // All segments except the last one are folders
    for (let i = 0; i < segments.length - 1; i++) {
      const segName = segments[i]
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${segName}` : segName

      let childFolder = currentNode.children.find(
        (c) => c.isFolder && c.name.toLowerCase() === segName.toLowerCase()
      )

      if (!childFolder) {
        childFolder = {
          id: accumulatedPath,
          name: segName,
          folderPath: accumulatedPath,
          isFolder: true,
          children: [],
          repoCount: 0
        }
        currentNode.children.push(childFolder)
      }

      childFolder.repoCount++
      currentNode = childFolder
    }

    // The last segment is the repository leaf item
    const leafName = segments[segments.length - 1]
    accumulatedPath = accumulatedPath ? `${accumulatedPath}/${leafName}` : leafName

    const leafNode: TreeNode = {
      id: accumulatedPath,
      name: repo.name || leafName,
      folderPath: accumulatedPath,
      isFolder: false,
      children: [],
      repo,
      repoCount: 1
    }

    currentNode.children.push(leafNode)
    root.repoCount++
  }

  // Sort children: folders first alphabetically, then repos alphabetically
  function sortNode(node: TreeNode) {
    node.children.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1
      if (!a.isFolder && b.isFolder) return 1
      return a.name.localeCompare(b.name, 'zh-CN')
    })
    for (const child of node.children) {
      if (child.isFolder) sortNode(child)
    }
  }

  sortNode(root)
  return root
}

// Find a node by path
export function findNodeByPath(root: TreeNode, targetPath: string): TreeNode | null {
  const cleanTarget = targetPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!cleanTarget) return root

  const segments = cleanTarget.split('/').filter(Boolean)
  let current: TreeNode | null = root

  for (const seg of segments) {
    if (!current) return null
    const next: TreeNode | undefined = current.children.find(
      (c) => c.name.toLowerCase() === seg.toLowerCase()
    )
    if (!next) return null
    current = next
  }

  return current
}

// Generate breadcrumb list from path
export function getBreadcrumbs(folderPath: string, repoName?: string): { name: string; path: string; isRepo?: boolean }[] {
  const crumbs: { name: string; path: string; isRepo?: boolean }[] = [{ name: '全部路径', path: '' }]
  if (!folderPath) return crumbs

  const segments = folderPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  let acc = ''

  for (let i = 0; i < segments.length; i++) {
    acc = acc ? `${acc}/${segments[i]}` : segments[i]
    crumbs.push({
      name: segments[i],
      path: acc,
      isRepo: false
    })
  }

  if (repoName) {
    crumbs.push({
      name: repoName,
      path: acc ? `${acc}/${repoName}` : repoName,
      isRepo: true
    })
  }

  return crumbs
}
