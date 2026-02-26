/**
 * 摩意模型页面 - iframe 嵌入原版
 */
import React from 'react';
import { Navigate } from 'react-router-dom';
import { usePermission } from '@/shared/contexts/PermissionContext';
import { canAccessMotoCost } from '@/shared/config/organizations';

export const MotoCostPage: React.FC = () => {
  const { userPermission } = usePermission();

  // 权限检查：仅 admin 和 xuechenglong 可访问
  if (!canAccessMotoCost(userPermission?.username)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="h-full w-full">
      <iframe
        src="https://alongor666.github.io/moto_cost/"
        title="摩意模型 - 摩托车使用成本计算器"
        className="w-full h-full border-0"
        style={{ minHeight: 'calc(100vh - 120px)' }}
      />
    </div>
  );
};

export default MotoCostPage;
