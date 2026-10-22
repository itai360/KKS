// What the staff may do beyond their own work, as the course commander set it in the settings'
// permissions (shared/permissions.ts). The commander may always; the dangerous actions and the final
// approvals are not abilities at all - they stay behind requireCommander / isCommander.

import type { NextFunction, Request, Response } from 'express';
import { staffMay, type StaffAbility } from '../../shared/permissions';
import { forbidden, getSettings, HttpError } from './core';

/** the commander - or anyone on the staff, where the commander lets them */
export function may(actor: { role: string }, ability: StaffAbility): boolean {
  return actor.role === 'commander' || staffMay(getSettings().staffPermissions, ability);
}

/** a route open to the commander and to the staff where the commander lets them */
export function requireAbility(ability: StaffAbility) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new HttpError(401, 'נדרשת התחברות'));
    if (!may(req.user, ability)) return next(forbidden('מפקד הקורס לא פתח את הפעולה הזו לסגל'));
    next();
  };
}
