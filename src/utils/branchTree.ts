export interface BranchItem {
  fullName: string
  leafName: string
  isCurrent: boolean
  upstream: string | null
  ahead: number
  behind: number
  trackStatus: string
}

export interface BranchFolderNode {
  id: string
  name: string
  folderPath: string
  subfolders: BranchFolderNode[]
  branches: BranchItem[]
  totalBranches: number
}

// Build hierarchical folder/branch tree by splitting git branch with '/'
// Branches without '/' are placed directly in root.branches
export function buildBranchTree(branches: BranchItem[], rootName: string = '项目'): BranchFolderNode {
  const root: BranchFolderNode = {
    id: 'root',
    name: rootName,
    folderPath: '',
    subfolders: [],
    branches: [],
    totalBranches: branches.length
  }

  for (const b of branches) {
    const rawName = b.fullName.replace(/^\/+|\/+$/g, '')
    const parts = rawName.split('/').filter(Boolean)

    // If branch has no '/' (e.g. "main", "master"), place directly at root
    if (parts.length <= 1) {
      root.branches.push({
        ...b,
        leafName: rawName
      })
      continue
    }

    // Branch has '/' (e.g. "dev/56ID/20260924/liuxing/VRHK-16903-SI-HAL-SNKO-添加字段")
    const folderParts = parts.slice(0, -1)
    const leafName = parts[parts.length - 1]

    let currentNode = root
    let accumulatedPath = ''

    for (const folderName of folderParts) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${folderName}` : folderName

      let childFolder = currentNode.subfolders.find(
        (f) => f.name.toLowerCase() === folderName.toLowerCase()
      )

      if (!childFolder) {
        childFolder = {
          id: accumulatedPath,
          name: folderName,
          folderPath: accumulatedPath,
          subfolders: [],
          branches: [],
          totalBranches: 0
        }
        currentNode.subfolders.push(childFolder)
      }

      childFolder.totalBranches++
      currentNode = childFolder
    }

    // Add branch to the target folder
    currentNode.branches.push({
      ...b,
      leafName
    })
  }

  // Sort subfolders and branches alphabetically
  function sortNode(node: BranchFolderNode) {
    node.subfolders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    node.branches.sort((a, b) => {
      // Put current branch first, then alphabetical
      if (a.isCurrent && !b.isCurrent) return -1
      if (!a.isCurrent && b.isCurrent) return 1
      return a.leafName.localeCompare(b.leafName, 'zh-CN')
    })
    for (const child of node.subfolders) {
      sortNode(child)
    }
  }

  sortNode(root)
  return root
}

// Find node by path
export function findBranchFolder(root: BranchFolderNode, path: string): BranchFolderNode | null {
  const cleanPath = path.replace(/^\/+|\/+$/g, '')
  if (!cleanPath) return root

  const segments = cleanPath.split('/').filter(Boolean)
  let current: BranchFolderNode | null = root

  for (const seg of segments) {
    if (!current) return null
    const next: BranchFolderNode | undefined = current.subfolders.find(
      (f) => f.name.toLowerCase() === seg.toLowerCase()
    )
    if (!next) return null
    current = next
  }

  return current
}

// Get breadcrumbs
export function getBranchBreadcrumbs(folderPath: string, rootName: string = '项目'): { name: string; path: string }[] {
  const crumbs = [{ name: rootName, path: '' }]
  if (!folderPath) return crumbs

  const segments = folderPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  let acc = ''
  for (const seg of segments) {
    acc = acc ? `${acc}/${seg}` : seg
    crumbs.push({
      name: seg,
      path: acc
    })
  }
  return crumbs
}
