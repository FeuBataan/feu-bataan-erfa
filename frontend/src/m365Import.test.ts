import { describe, expect, it } from 'vitest';
import { buildImportPayload, departmentCode, departmentCounts, parseCsv, readM365Users } from './m365Import';

const exportCsv = String.fromCharCode(0xfeff) + '"Block credential","Department","Display name","First name","Last name","Title","User principal name","Licenses"\r\n'
  + 'False,"College of Education","Maria Santos","Maria L.","Santos","Faculty","Maria.Santos@uncbataan.edu.ph","Office 365 A1"\r\n'
  + 'False,"Finance Office","Carla Mendoza","Carla","Mendoza","Accountant, Senior","carla@uncbataan.edu.ph",""\r\n'
  + 'True,"Finance Office","Old Account","","","","old@uncbataan.edu.ph",""\r\n'
  + 'False,"","eRFA Mailbox","","","","erfa@uncbataan.edu.ph",""\r\n'
  + 'False,"Student","Student One","Stu","One","","s1@student.uncbataan.edu.ph",""\r\n';

describe('Microsoft 365 user export import', () => {
  it('parses quoted CSV fields', () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3')).toEqual([['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
  });

  it('reads people with Last, First names and the sign-in address', () => {
    const people = readM365Users(exportCsv);
    expect(people).toHaveLength(5);
    expect(people[0]).toEqual({ fullName: 'Santos, Maria L.', email: 'maria.santos@uncbataan.edu.ph', department: 'College of Education', position: 'Faculty', blocked: false });
    expect(people[1].position).toBe('Accountant, Senior');
    expect(people[2].blocked).toBe(true);
    expect(people[3].fullName).toBe('eRFA Mailbox');
  });

  it('refuses files that are not a user export', () => {
    expect(() => readM365Users('Name,Amount\nA,1')).toThrow(/Export users/);
  });

  it('counts people per department', () => {
    expect(departmentCounts(readM365Users(exportCsv))).toEqual([
      { department: '', count: 1 }, { department: 'College of Education', count: 1 }, { department: 'Finance Office', count: 2 }, { department: 'Student', count: 1 }
    ]);
  });

  it('makes short unique department codes', () => {
    const taken = new Set(['FO']);
    expect(departmentCode('College of Education', taken)).toBe('CE');
    expect(departmentCode('Finance Office', taken)).toBe('FO2');
    expect(departmentCode('Registrar', taken)).toBe('REGIST');
  });

  it('builds the payload for chosen departments and the school domain, leaving out blocked accounts', () => {
    const payload = buildImportPayload(readM365Users(exportCsv), { domain: 'uncbataan.edu.ph', departments: new Set(['College of Education', 'Finance Office', 'Student']), includeBlocked: false }, ['CE']);
    expect(payload.departments).toEqual([{ departmentName: 'College of Education', departmentCode: 'CE2' }, { departmentName: 'Finance Office', departmentCode: 'FO' }]);
    expect(payload.users.map((user) => user.email)).toEqual(['maria.santos@uncbataan.edu.ph', 'carla@uncbataan.edu.ph']);
  });
});
