/**
 * 文件菜单（features/file 组合层）
 *
 * 把「文件」下拉触发器 + 导入 / 导出 / 报表模板三个弹窗及其开合状态收敛在此，
 * 由上层（App.tsx）以 slot 形式注入顶栏（`<SidebarLayout fileMenu={<FileMenu />} />`）。
 * 这样 components/layout 的 TopNavigation 不再反向 import features（B330 依赖倒置修复，
 * follow-up 2026-06-15-claude-edbd61）。
 *
 * DropdownMenu 为顶栏通用原语，按 features → layout 的正确依赖方向引用。
 * 三个弹窗经 createPortal 渲染到 document.body：顶栏 header 带 opacity-30，若弹窗
 * 作为 header 后代会被整体降透明度，portal 到 body 可保持弹窗独立于顶栏淡入淡出。
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, Download, Upload, ClipboardList } from 'lucide-react';
import { DropdownMenu, type DropdownItem } from '../../components/layout/DropdownMenu';
import { DataImportModal } from './DataImportModal';
import { ExportModal } from './ExportModal';
import { ReportTemplatesModal } from './ReportTemplatesModal';

export const FileMenu: React.FC = () => {
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);

  const fileMenuItems: DropdownItem[] = [
    { icon: Download, label: '导入数据', onClick: () => setIsImportOpen(true) },
    { icon: Upload, label: '导出数据', onClick: () => setIsExportOpen(true) },
    { icon: ClipboardList, label: '报表模板', onClick: () => setIsTemplatesOpen(true), divider: true },
  ];

  return (
    <>
      <DropdownMenu icon={FolderOpen} label="文件" items={fileMenuItems} />
      {createPortal(
        <>
          <DataImportModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />
          <ExportModal isOpen={isExportOpen} onClose={() => setIsExportOpen(false)} />
          <ReportTemplatesModal isOpen={isTemplatesOpen} onClose={() => setIsTemplatesOpen(false)} />
        </>,
        document.body
      )}
    </>
  );
};
