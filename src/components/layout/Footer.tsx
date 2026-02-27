import React from 'react';

export const Footer: React.FC = () => {
  return (
    <div className="mt-8 pt-4 pb-2 border-t border-neutral-100 text-center text-[10px] text-neutral-400 bg-transparent flex flex-col items-center space-y-1.5 w-full">
      <a
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noreferrer"
        className="hover:text-neutral-600 transition-colors"
      >
        蜀ICP备2024115865号
      </a>
      <a
        href="http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=51019002007622"
        target="_blank"
        rel="noreferrer"
        className="flex items-center hover:text-neutral-600 transition-colors gap-1"
      >
        <img
          src="https://beian.mps.gov.cn/img/logo01.dd7ff50e.png"
          alt=""
          className="w-3 h-3 object-contain opacity-70"
        />
        <span>川公网安备51019002007622号</span>
      </a>
    </div>
  );
};
