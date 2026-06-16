// OGz Studios — admin CLI entrypoint
// Usage: pnpm --filter @openclaw/admin-cli tsx src/index.ts <command>
export async function main(argv: string[]): Promise<void> {
  console.log("admin-cli", argv);
}
