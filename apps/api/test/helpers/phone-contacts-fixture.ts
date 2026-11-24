import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {PGliteDatabase,Migrator,WorkspaceRepository,UserRepository,MembershipRepository,SessionRepository,generateSessionToken,hashSessionToken} from '@thaara/db';

/** Applies the reviewed Step 110a SQL to a throwaway in-memory PGlite database only (owner-approved local testing). */
export const PHONE_CONTACTS_SQL=fs.readFileSync(fileURLToPath(new URL('../../../../docs/migrations/110a-phone-contacts.review.sql',import.meta.url)),'utf8');
export const approve110a=(db:PGliteDatabase)=>db.query("SELECT set_config('thaara.step110a_review_approved','yes',false),set_config('thaara.step110a_target_database',current_database(),false)");

export const PHONE_CALLS_SQL=fs.readFileSync(fileURLToPath(new URL('../../../../docs/migrations/110b-phone-calls.review.sql',import.meta.url)),'utf8');
export const approve110b=(db:PGliteDatabase)=>db.query("SELECT set_config('thaara.step110b_review_approved','yes',false),set_config('thaara.step110b_target_database',current_database(),false)");

export const PHONE_LIVE_SQL=fs.readFileSync(fileURLToPath(new URL('../../../../docs/migrations/110c-phone-live-mode.review.sql',import.meta.url)),'utf8');
export const approve110c=(db:PGliteDatabase)=>db.query("SELECT set_config('thaara.step110c_review_approved','yes',false),set_config('thaara.step110c_target_database',current_database(),false)");

export async function phoneContactsDatabase(options:{calls?:boolean;live?:boolean}={}){
 const db=new PGliteDatabase(),migrator=new Migrator(db);await migrator.migrate(migrator.loadMigrationFiles());
 const ws=await new WorkspaceRepository(db).create('phone-contacts-synthetic'),ws2=await new WorkspaceRepository(db).create('phone-contacts-other');
 async function identity(name:string,role:'owner'|'member'|'viewer',workspaceId=ws.id){
  const user=await new UserRepository(db).create(name+'@example.test','unused',name),token=generateSessionToken();
  const scope={workspaceId,userId:user.id,role,sessionTokenHash:hashSessionToken(token)};
  await db.withScopedTransaction(scope,async tx=>{await new MembershipRepository(tx).create(workspaceId,user.id,role);await new SessionRepository(tx).create(user.id,workspaceId,token);});
  return {...scope,token};
 }
 const owner=await identity('pc-owner','owner'),member=await identity('pc-member','member'),viewer=await identity('pc-viewer','viewer'),foreign=await identity('pc-foreign','owner',ws2.id);
 await approve110a(db);await db.exec(PHONE_CONTACTS_SQL);
 if(options.calls||options.live){await approve110b(db);await db.exec(PHONE_CALLS_SQL);}
 if(options.live){await approve110c(db);await db.exec(PHONE_LIVE_SQL);}
 await db.exec('SET ROLE thaara_app;');
 return {db,owner,member,viewer,foreign};
}
