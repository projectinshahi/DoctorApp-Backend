const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function listSubjects(req, res) {
  try {
    const subjects = await prisma.subject.findMany({
      orderBy: { name: 'asc' },
    });
    return res.status(200).json({ subjects });
  } catch (error) {
    console.error('List subjects error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while fetching subjects' },
    });
  }
}

async function createSubject(req, res) {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        error: { message: 'Subject name is required' },
      });
    }

    const subject = await prisma.subject.create({
      data: { name: name.trim() },
    });

    return res.status(201).json({ subject });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        error: { message: 'A subject with this name already exists' },
      });
    }
    console.error('Create subject error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while creating the subject' },
    });
  }
}

module.exports = { listSubjects, createSubject };