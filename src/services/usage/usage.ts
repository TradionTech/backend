import { UsageStat } from '../../db/models/UsageStat';
import { User } from '../../db/models/User';

export const Usage = {
  async ensureDailyRow(userId: string) {
    const row = await UsageStat.findOne({ where: { userId } });
    const now = new Date();
    if (!row) {
      await UsageStat.create({ userId, chatToday: 0, analysesToday: 0, lastResetAt: now });
      return;
    }
    const last = new Date(row.lastResetAt);
    if (last.toDateString() !== now.toDateString()) {
      row.chatToday = 0;
      row.analysesToday = 0;
      row.lastResetAt = now as any;
      await row.save();
    }
  },
  async getPlan(userId: string): Promise<'free' | 'pro'> {
    const user = await User.findByPk(userId);
    return user?.plan ?? 'free';
  },
  async getCounters(userId: string) {
    const row = await UsageStat.findOne({ where: { userId } });
    return { chatToday: row?.chatToday ?? 0, analysesToday: row?.analysesToday ?? 0 };
  },
  async inc(userId: string, field: 'chatToday' | 'analysesToday') {
    const row = await UsageStat.findOne({ where: { userId } });
    if (!row) return;
    (row as any)[field] += 1;
    await row.save();
  },
};
