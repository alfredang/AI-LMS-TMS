import React, { useState } from 'react';
import { Icon, IconName } from '@components/ui/Icon';
import { TOOL_GROUPS, ToolLinkItem } from '@components/toolsData';

interface ToolsMenuProps {
  collapsed?: boolean;
  /** Group key whose tools page is currently shown in the main content (highlights the header). */
  activeGroupKey?: string | null;
  /** Called with the group key when a group header is clicked, so the host layout can show its tools card page. */
  onSelectGroup?: (key: string) => void;
}

const inactiveClass = 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';
const subItemClass = 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-white';

const ToolLink: React.FC<ToolLinkItem> = ({ label, icon, href }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className={`group flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all duration-150 ${subItemClass}`}
  >
    <Icon name={icon} className="w-4 h-4 flex-shrink-0 text-gray-400 dark:text-gray-500 group-hover:text-gray-900 dark:group-hover:text-white transition-colors" />
    <span className="truncate">{label}</span>
    <Icon name={IconName.ExternalLink} className="w-3 h-3 ml-auto text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
  </a>
);

/**
 * The full sidebar TOOLS section (same catalogue as the trainer sidebar,
 * sourced from components/toolsData.ts) as expand/collapse external links.
 * Optionally page-aware: pass onSelectGroup/activeGroupKey and the host
 * layout can render that group's tools card page (as the trainer role does).
 */
const ToolsMenu: React.FC<ToolsMenuProps> = ({ collapsed = false, activeGroupKey = null, onSelectGroup }) => {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [openSubGroups, setOpenSubGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (key: string) =>
    setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }));
  const toggleSubGroup = (key: string) =>
    setOpenSubGroups(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <>
      {/* Divider — Tools */}
      <div className="mt-4 mb-2 px-2">
        <div className="border-t border-gray-200 dark:border-gray-700" />
        {!collapsed && (
          <p className="mt-3 px-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 select-none">
            Tools
          </p>
        )}
      </div>

      {TOOL_GROUPS.map(group => (
        <React.Fragment key={group.key}>
          <button
            onClick={() => {
              toggleGroup(group.key);
              onSelectGroup?.(group.key);
            }}
            title={collapsed ? group.label : undefined}
            className={`group flex items-center ${collapsed ? 'justify-center px-0' : 'gap-3 px-3'} w-full rounded-xl py-2.5 text-sm font-medium transition-all duration-150 ${
              activeGroupKey === group.key ? 'bg-primary/10 text-primary' : inactiveClass
            }`}
          >
            <Icon
              name={group.icon}
              className={`w-[18px] h-[18px] flex-shrink-0 transition-colors ${
                activeGroupKey === group.key ? 'text-primary' : 'text-gray-400 dark:text-gray-500'
              }`}
            />
            {!collapsed && <span className="truncate">{group.label}</span>}
            {!collapsed && (
              <Icon
                name={IconName.ChevronDown}
                className={`w-4 h-4 ml-auto flex-shrink-0 transition-transform duration-200 ${
                  openGroups[group.key] ? 'rotate-0' : '-rotate-90'
                } ${activeGroupKey === group.key ? 'text-primary' : 'text-gray-400 dark:text-gray-500'}`}
              />
            )}
          </button>

          {!collapsed && openGroups[group.key] && (
            <div className="ml-5 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {'items' in group
                ? group.items.map(item => <ToolLink key={item.label} {...item} />)
                : group.groups.map(({ category, items }) => (
                    <div key={category}>
                      <button
                        onClick={() => toggleSubGroup(`${group.key}:${category}`)}
                        className="group flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-[10px] font-bold uppercase tracking-widest text-muted select-none mt-1"
                      >
                        <Icon
                          name={IconName.ChevronDown}
                          className={`w-3 h-3 flex-shrink-0 transition-transform duration-200 text-gray-400 dark:text-gray-500 ${
                            openSubGroups[`${group.key}:${category}`] ? 'rotate-0' : '-rotate-90'
                          }`}
                        />
                        <span>{category}</span>
                      </button>
                      {openSubGroups[`${group.key}:${category}`] &&
                        items.map(item => <ToolLink key={item.label} {...item} />)}
                    </div>
                  ))}
            </div>
          )}
        </React.Fragment>
      ))}
    </>
  );
};

export default ToolsMenu;
