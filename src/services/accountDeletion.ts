import { Types } from 'mongoose';
import { User } from '../models/User';
import { Group } from '../models/Group';
import { GroupExpense } from '../models/GroupExpense';
import { PersonalExpense } from '../models/PersonalExpense';
import { AssistantUsage } from '../models/AssistantUsage';
import { AssistantMiss } from '../models/AssistantIntent';
import { UserCategory } from '../models/Category';
import { PasswordResetRequest } from '../models/PasswordResetRequest';

/**
 * Permanently deletes a user account and every piece of data tied to it —
 * shared by the in-app "delete my account" action and the public
 * account-deletion web page (Play Store requires the latter to work without the app installed).
 */
export async function deleteUserAndAllData(userId: string): Promise<void> {
  const uid = new Types.ObjectId(userId);

  const groups = await Group.find({ 'members.user': uid });
  for (const group of groups) {
    group.members = group.members.filter(m => m.user.toString() !== userId);
    if (group.members.length === 0) {
      await GroupExpense.deleteMany({ group: group._id });
      await group.deleteOne();
    } else {
      if (group.createdBy.toString() === userId) {
        group.createdBy = group.members[0].user;
        group.members[0].role = 'owner';
      }
      await group.save();
    }
  }

  await GroupExpense.deleteMany({ createdBy: uid });
  await PersonalExpense.deleteMany({ user: uid });
  await AssistantUsage.deleteMany({ userId: String(userId) });
  await AssistantMiss.deleteMany({ userId: uid });
  await UserCategory.deleteMany({ user: uid });
  await PasswordResetRequest.deleteMany({ user: uid });
  await User.deleteOne({ _id: uid });
}
