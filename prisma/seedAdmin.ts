import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma";
import bcrypt from "bcrypt";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const existingAdmin = await prisma.admin.findFirst();

  if (existingAdmin) {
    console.log("Admin already exists. Skipping creation.");
    console.log(`Existing admin email: ${existingAdmin.email}`);
    return;
  }

  const email = "admin@yourapp.com"; // change this
  const plainPassword = "Admindrapp@2026!"; // change this

  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  const admin = await prisma.admin.create({
    data: {
      email,
      password: hashedPassword,
      name: "Super Admin",
    },
  });

  console.log("Admin created successfully:", admin.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });