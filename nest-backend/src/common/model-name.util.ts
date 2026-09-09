/** Sheet/table name ("stock_movement") -> Prisma Client delegate name
 * ("stockMovement") — every model's @@map matches its sheet name exactly. */
export function toModelName(tableName: string): string {
    return tableName.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
