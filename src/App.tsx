import { useState } from 'react';

type Role = 'School Community' | 'Designated Personnel' | 'School Leader' | 'ICT / System Administrator';

const roleDetails: Record<Role, { icon: string; summary: string; actions: string[] }> = {
  'School Community': { icon: '◉', summary: 'A safe way for every voice in the school community to be heard.', actions: ['Answer a school climate survey', 'Report a hazard or incident', 'View approved alerts and announcements'] },
  'Designated Personnel': { icon: '⌁', summary: 'Coordinate safety action while keeping school leaders in the approval loop.', actions: ['Review assigned hazard reports', 'Monitor survey trends', 'Draft an alert for approval'] },
  'School Leader': { icon: '◆', summary: 'One view of safety, wellbeing, communications, and school-wide action.', actions: ['Approve a pending emergency advisory', 'Review live safety indicators', 'Assign a report for follow-up'] },
  'ICT / System Administrator': { icon: '▦', summary: 'Maintain trusted access and an accurate digital map of the school.', actions: ['Manage user accounts', 'Update buildings and rooms', 'Review account access status'] },
};

const stats = [['86%', 'Survey response rate'], ['12', 'Reports being handled'], ['4', 'Pending approvals']];

export function App() {
  const [role, setRole] = useState<Role>('School Community');
  const [notice, setNotice] = useState('');
  const current = roleDetails[role];
  return <main>
    <header>
      <a className="brand" href="#top"><span>◈</span> SENTINEL</a>
      <span className="tag">Safer schools. Stronger voices.</span>
    </header>
    <section className="hero" id="top">
      <p className="eyebrow">SCHOOL SAFETY & LEARNING ENVIRONMENT</p>
      <h1>Every voice can help build a safer school.</h1>
      <p className="lede">SENTINEL brings surveys, incident reporting, alerts, and safety action together in one trusted place.</p>
      <button onClick={() => setNotice('Choose your role below to explore the preview.')}>Explore the preview <span>→</span></button>
      {notice && <p className="notice">{notice}</p>}
    </section>
    <section className="role-section" aria-labelledby="roles-heading">
      <p className="eyebrow">ROLE-BASED ACCESS</p><h2 id="roles-heading">One system, clear responsibilities.</h2>
      <div className="role-tabs" role="tablist">
        {(Object.keys(roleDetails) as Role[]).map(item => <button className={item === role ? 'active' : ''} key={item} onClick={() => { setRole(item); setNotice(''); }} role="tab" aria-selected={item === role}>{item}</button>)}
      </div>
      <article className="dashboard">
        <div className="role-symbol">{current.icon}</div>
        <div><p className="eyebrow">{role}</p><h3>{current.summary}</h3><ul>{current.actions.map(action => <li key={action}>{action}</li>)}</ul></div>
        <aside>{role === 'School Leader' ? <><span className="status urgent">Approval needed</span><strong>Rainfall advisory</strong><p>Prepared by DRRM Coordinator</p><button className="secondary" onClick={() => setNotice('Preview: the School Leader can approve, reject, or revise this alert.')}>Review approval</button></> : <><span className="status">Role preview</span><strong>Secure access</strong><p>Permissions are limited to this role’s responsibilities.</p></>}</aside>
      </article>
    </section>
    <section className="pulse"><p className="eyebrow">SCHOOL PULSE</p><h2>See concerns early. Respond with confidence.</h2><div className="stats">{stats.map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div></section>
    <section className="report"><div><p className="eyebrow">COMMUNITY REPORTING</p><h2>See something unsafe?</h2><p>Report a hazard, safety concern, or wellbeing issue. You can choose to share contact details or submit anonymously.</p></div><button onClick={() => setNotice('Preview: this will open the secure incident and hazard report form.')}>Make a report <span>→</span></button></section>
    <footer>© 2026 SENTINEL <span>•</span> Safe, respectful, and motivating learning environments</footer>
  </main>;
}
