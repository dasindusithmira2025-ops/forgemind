import { prisma } from "@repo/db";
export async function enqueueUserJob(userId: string) { return prisma.job.create({ data: { userId } }); }
