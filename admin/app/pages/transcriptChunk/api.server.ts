import { app } from '../../_server/app';
import { userProcedures } from '../../_server/userProcedures';

const controller = app.defineTableController(
  {},
  {
    ...userProcedures,
  }
);

export type Procedures = typeof controller.procedures;
export default controller;
