/**
 * Turns the Microsoft 365 admin center "Export users" CSV into an eRFA import payload, so staff do
 * not have to be typed in. Uses: Display name / First name / Last name, User principal name (the
 * sign-in address), Department, Title, and Block credential (blocked accounts are left out).
 */

const BOM = String.fromCharCode(0xfeff); // Excel adds this invisible mark at the start of CSV files

/** Parse CSV text (quoted fields, commas and new lines inside quotes, "" escapes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = (text.startsWith(BOM) ? text.slice(1) : text);
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

export interface M365Person { fullName: string; email: string; department: string; position: string; blocked: boolean }

const header = (name: string) => name.trim().toLowerCase().replace(/[^a-z]/g, '');

/** Read the people out of a Microsoft 365 user export. Throws when the file is not one. */
export function readM365Users(text: string): M365Person[] {
  const [head, ...body] = parseCsv(text);
  if (!head) throw new Error('The file is empty.');
  const index = new Map(head.map((name, i) => [header(name), i]));
  const col = (row: string[], ...names: string[]) => {
    for (const name of names) { const i = index.get(name); if (i !== undefined && row[i]?.trim()) return row[i].trim(); }
    return '';
  };
  if (!index.has('userprincipalname') && !index.has('mail') && !index.has('email')) {
    throw new Error('This is not a Microsoft 365 user export. In the Microsoft 365 admin center go to Users > Active users > Export users, then choose that CSV file.');
  }
  return body.map((row) => {
    const first = col(row, 'firstname', 'givenname');
    const last = col(row, 'lastname', 'surname');
    const display = col(row, 'displayname', 'name');
    return {
      // Same style as the rest of eRFA: "Last, First" when both parts are known.
      fullName: first && last ? `${last}, ${first}` : display,
      email: col(row, 'userprincipalname', 'mail', 'email').toLowerCase(),
      department: col(row, 'department'),
      position: col(row, 'title', 'jobtitle'),
      blocked: /^(true|yes|1)$/i.test(col(row, 'blockcredential', 'blocksignin'))
    };
  }).filter((person) => person.email);
}

/** Short unique code for a department name, e.g. "College of Education" -> "CE". */
export function departmentCode(name: string, taken: Set<string>): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((word) => word && !['OF', 'AND', 'THE', 'FOR', 'IN'].includes(word));
  let base = words.length > 1 ? words.map((word) => word[0]).join('').slice(0, 6) : (words[0] || 'DEPT').slice(0, 6);
  if (!base) base = 'DEPT';
  let code = base;
  for (let n = 2; taken.has(code); n += 1) code = `${base}${n}`;
  taken.add(code);
  return code;
}

export interface ImportChoice { domain: string; departments: Set<string>; includeBlocked: boolean }

/** Departments in the export with how many people each has ('' = no department set). */
export function departmentCounts(people: M365Person[]): Array<{ department: string; count: number }> {
  const counts = new Map<string, number>();
  for (const person of people) counts.set(person.department, (counts.get(person.department) ?? 0) + 1);
  return [...counts].map(([department, count]) => ({ department, count })).sort((a, b) => a.department.localeCompare(b.department));
}

/**
 * The eRFA import payload for the chosen people. Everyone imported can create RFAs; who approves,
 * who heads each department, and the officials are then set in Administration.
 */
export function buildImportPayload(people: M365Person[], choice: ImportChoice, existingCodes: string[] = []) {
  const domain = choice.domain.trim().toLowerCase().replace(/^@/, '');
  const chosen = people.filter((person) => (choice.includeBlocked || !person.blocked)
    && choice.departments.has(person.department)
    && (!domain || person.email.endsWith(`@${domain}`)));
  const taken = new Set(existingCodes.map((code) => code.toUpperCase()));
  const departments = [...new Set(chosen.map((person) => person.department).filter(Boolean))].sort()
    .map((departmentName) => ({ departmentName, departmentCode: departmentCode(departmentName, taken) }));
  const users = chosen.map((person) => ({
    fullName: person.fullName || person.email, email: person.email, departmentName: person.department, position: person.position,
    ...(person.blocked ? { active: false } : {})
  }));
  return { departments, users, heads: [] as Array<{ departmentCode: string; userEmail: string }> };
}
