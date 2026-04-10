import crypto from 'node:crypto'
import {
  Node,
  SyntaxKind,
  FunctionDeclaration,
  ArrowFunction,
  VariableDeclaration,
  ClassDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  SourceFile,
} from 'ts-morph'

export type TopLevelDeclaration =
  | FunctionDeclaration
  | VariableDeclaration
  | ClassDeclaration
  | InterfaceDeclaration
  | TypeAliasDeclaration

/**
 * Returns all top-level named declarations in a SourceFile.
 */
export function getTopLevelDeclarations(sourceFile: SourceFile): TopLevelDeclaration[] {
  const decls: TopLevelDeclaration[] = []

  decls.push(...sourceFile.getFunctions())
  decls.push(...sourceFile.getClasses())
  decls.push(...sourceFile.getInterfaces())
  decls.push(...sourceFile.getTypeAliases())

  for (const varStmt of sourceFile.getVariableStatements()) {
    decls.push(...varStmt.getDeclarations())
  }

  return decls
}

/**
 * Returns true if the given node has a JSDoc `@internal` or `@private` tag.
 */
export function hasInternalTag(node: Node): boolean {
  if (!Node.isJSDocable(node)) return false
  return node.getJsDocs().some((doc) =>
    doc.getTags().some((tag) => {
      const name = tag.getTagName()
      return name === 'internal' || name === 'private'
    }),
  )
}

/**
 * Returns the leading comment text for a node, if any.
 */
export function getLeadingComment(node: Node): string | undefined {
  const fullText = node.getFullText()
  const match = fullText.match(/^(\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/\s*)+/)
  return match?.[0]?.trim()
}

/**
 * Checks whether a node is exported (has the `export` keyword).
 */
export function isExported(node: Node): boolean {
  return node.getFirstDescendantByKind(SyntaxKind.ExportKeyword) !== undefined
}

/**
 * Returns the name of a declaration node, or undefined if it is anonymous.
 */
export function getDeclarationName(node: TopLevelDeclaration): string | undefined {
  if ('getName' in node && typeof node.getName === 'function') {
    return node.getName() ?? undefined
  }
  return undefined
}

/**
 * Hashes the body of a function by walking its AST and replacing all
 * identifier names with sequential placeholders, so structurally identical
 * functions produce the same hash regardless of variable names.
 */
export function hashFunctionBody(func: FunctionDeclaration | ArrowFunction): string {
  const body = func.getBody()
  if (!body) return ''
  const identMap = new Map<string, string>()
  const normalized = normalizeNode(body, identMap)
  return crypto.createHash('sha256').update(normalized).digest('hex')
}

function normalizeNode(node: Node, identMap: Map<string, string>): string {
  if (node.getKind() === SyntaxKind.Identifier) {
    const text = node.getText()
    if (!identMap.has(text)) identMap.set(text, `$${identMap.size}`)
    return identMap.get(text)!
  }
  const children = node.getChildren()
  if (children.length === 0) return node.getText()
  return `[${node.getKindName()}:${children.map((c) => normalizeNode(c, identMap)).join(',')}]`
}
