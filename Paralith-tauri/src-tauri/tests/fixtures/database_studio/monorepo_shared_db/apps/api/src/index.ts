import { prisma } from "@repo/db";
export async function listUsers() { return prisma.user.findMany(); }
