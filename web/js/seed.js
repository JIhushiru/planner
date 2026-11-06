'use strict';
/*
 * Built-in content. A copy of the repo ships no study plans: each person keeps their own in
 * web/js/seed.local.js (gitignored, loaded right after this file), which pushes onto SEED_PLANS and
 * LOCAL_HEALTH_NOTES. Seeded plans are added once, by id (tracked in data.seeded), so editing or
 * deleting them in the app sticks. tests/fixtures/plans.js shows the shape of a plan.
 */

const CAT_PALETTE = ['#4F7CFF', '#8B5CF6', '#D9AE5B', '#F59E0B', '#10B981', '#EF4444', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16', '#06B6D4', '#64748B'];

const DEFAULT_CATEGORIES = [
  { id: 'c-class', name: 'Class', color: '#4F7CFF' },
  { id: 'c-study', name: 'Study', color: '#8B5CF6' },
  { id: 'c-exam', name: 'Exam', color: '#D9AE5B' },
  { id: 'c-work', name: 'Work', color: '#F59E0B' },
  { id: 'c-personal', name: 'Personal', color: '#10B981' },
  { id: 'c-health', name: 'Health', color: '#EF4444' },
  { id: 'c-social', name: 'Social', color: '#EC4899' },
];

/** Plans to add the first time a data file meets them (filled by seed.local.js). */
const SEED_PLANS = [];
/** Extra lines for the Health page's "Before you start" list (filled by seed.local.js). */
const LOCAL_HEALTH_NOTES = [];
