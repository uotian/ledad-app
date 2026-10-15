import SettingsButton from '@/components/settings/SettingsButton';
import Brand from './Brand';
export default function Sidebar({ onHome }: { onHome?: () => void }) {
  return (
    <aside className="sidebar">
      <Brand onHome={onHome} />
      <div className="sidebar-bottom">
        <SettingsButton />
      </div>
    </aside>
  );
}
