export type Role = 'admin' | 'member' | 'external_partner';

export type Action =
  | 'create_project'
  | 'edit_project'
  | 'cancel_run'
  | 'submit_review'
  | 'view_settings'
  | 'manage_members'
  | 'manage_wincross_profiles'
  | 'manage_billing'
  | 'view_billing'
  | 'delete_project'
  | 'remove_member';

const PERMISSION_MAP: Record<Action, Role[]> = {
  create_project: ['admin', 'member'],
  edit_project: ['admin', 'member'],
  cancel_run: ['admin', 'member'],
  submit_review: ['admin', 'member'],
  view_settings: ['admin', 'member'],
  manage_members: ['admin'],
  manage_wincross_profiles: ['admin'],
  manage_billing: ['admin'],
  view_billing: ['admin', 'member'],
  delete_project: ['admin'],
  remove_member: ['admin'],
};

export function canPerform(role: Role | null, action: Action): boolean {
  if (!role) return false;
  return PERMISSION_MAP[action].includes(role);
}
