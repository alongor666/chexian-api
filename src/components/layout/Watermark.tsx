import React, { useMemo } from 'react';
import { usePermission } from '../../shared/contexts/PermissionContext';

/**
 * 全局水印组件 — 非管理员用户显示账号水印，起警示溯源作用
 * Canvas 绘制文字 → base64 平铺背景，pointer-events:none 不影响交互
 */
export const Watermark: React.FC = () => {
  const { isBranchAdmin, userPermission } = usePermission();

  const bgImage = useMemo(() => {
    const username = userPermission?.username;
    if (!username) return null;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    canvas.width = 300;
    canvas.height = 200;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 旋转 -30°
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((-30 * Math.PI) / 180);
    ctx.fillText(username, 0, 0);

    return canvas.toDataURL();
  }, [userPermission?.username]);

  // 管理员或未登录不渲染
  if (isBranchAdmin || !bgImage) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        backgroundImage: `url(${bgImage})`,
        backgroundRepeat: 'repeat',
      }}
    />
  );
};
