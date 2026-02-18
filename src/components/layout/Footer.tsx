import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full py-6 bg-white border-t border-gray-200 text-center text-xs text-gray-500 mt-auto">
      <div className="container mx-auto px-4 flex flex-col items-center justify-center space-y-2">
        <div className="flex items-center gap-2 flex-wrap justify-center">
          <span>&copy; {new Date().getFullYear()} cretvalu.com</span>
          <span className="hidden sm:inline text-gray-300">|</span>
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noreferrer"
            className="hover:text-gray-700 transition-colors"
          >
            蜀ICP备2024115865号
          </a>
          <span className="hidden sm:inline text-gray-300">|</span>
          <a
            href="http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=51019002007622"
            target="_blank"
            rel="noreferrer"
            className="flex items-center hover:text-gray-700 transition-colors gap-1"
          >
            <img 
               src="https://beian.mps.gov.cn/img/logo01.dd7ff50e.png" 
               alt="" 
               className="w-4 h-4 object-contain"
               style={{ display: 'inline-block' }} 
            />
            <span>川公网安备51019002007622号</span>
          </a>
        </div>
        <div className="text-gray-400">
          网站开通日期: 2024-12-22
        </div>
      </div>
    </footer>
  );
};
