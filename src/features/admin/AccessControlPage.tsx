import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { apiClient, AccessUser, AccessRole } from '../../shared/api/client';
import {
  Button,
  Card,
  ConfirmDialog,
  FormItem,
  Input,
  Select,
  Table,
  useConfirmDialog,
} from '../../shared/ui';
import {
  FEE_ANALYSIS_ALLOWED_USERS,
  MOTO_COST_ALLOWED_USERS,
  COST_ALLOWED_USERS,
} from '../../shared/config/organizations';

/**
 * 所有可通过路由白名单配置的路由列表。
 * 注意：以下路由通过代码白名单控制，不在此处配置：
 *   - /fee-analysis  → FEE_ANALYSIS_ALLOWED_USERS
 *   - /cost          → COST_ALLOWED_USERS
 *   - /moto-cost     → MOTO_COST_ALLOWED_USERS
 *   - /admin/access-control → 由 isBranchAdmin 角色控制
 */
const ALL_ROUTES = [
  { path: '/', label: '首页' },
  { path: '/dashboard', label: '仪表盘' },
  { path: '/performance-analysis', label: '业绩分析' },
  { path: '/premium-report', label: '保费报表' },
  { path: '/marketing-report', label: '营销战报' },
  { path: '/truck', label: '营业货车' },
  { path: '/renewal', label: '续保分析' },
  { path: '/cross-sell', label: '驾乘险推介率' },
  { path: '/growth', label: '增长分析' },
  { path: '/comparison', label: '数据对比' },
  { path: '/coefficient', label: '系数监控' },
  { path: '/sql-query', label: 'SQL查询' },
  { path: '/templates', label: '报表模板' },
];

type UserFormState = {
  id?: string;
  username: string;
  displayName: string;
  password: string;
  role: string;
  organization: string;
  allowedRoutes: string[];
  defaultRoute: string;
  allowedIps: string;
  active: boolean;
};

type RoleFormState = {
  role: string;
  name: string;
  dataScope: 'all' | 'org' | 'telemarketing';
  allowedRoutes: string[];
  defaultRoute: string;
};

const emptyUserForm: UserFormState = {
  username: '',
  displayName: '',
  password: '',
  role: '',
  organization: '',
  allowedRoutes: [],
  defaultRoute: '',
  allowedIps: '',
  active: true,
};

const emptyRoleForm: RoleFormState = {
  role: '',
  name: '',
  dataScope: 'org',
  allowedRoutes: [],
  defaultRoute: '',
};

const splitIpList = (value: string): string[] =>
  value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);

const joinList = (value?: string[]): string => {
  if (!value || value.length === 0) return '';
  return value.join(', ');
};

// 路由复选框组件
const RouteCheckboxGroup: React.FC<{
  selected: string[];
  onChange: (routes: string[]) => void;
}> = ({ selected, onChange }) => {
  const toggle = (path: string, checked: boolean) => {
    const next = checked ? [...selected, path] : selected.filter(r => r !== path);
    onChange(next);
  };

  return (
    <div className="mt-1 p-3 rounded-lg border border-neutral-200 bg-neutral-50">
      <p className="text-xs text-neutral-400 mb-2">不勾选任何路由 = 允许访问所有路由</p>
      <div className="grid grid-cols-2 gap-1">
        {ALL_ROUTES.map(route => (
          <label
            key={route.path}
            className="flex items-center gap-2 cursor-pointer rounded px-2 py-1 hover:bg-white transition-colors"
          >
            <input
              type="checkbox"
              checked={selected.includes(route.path)}
              onChange={e => toggle(route.path, e.target.checked)}
              className="w-4 h-4 rounded accent-primary cursor-pointer"
            />
            <span className="text-sm text-neutral-700">{route.label}</span>
            <span className="text-xs text-neutral-400 ml-auto hidden sm:block">{route.path}</span>
          </label>
        ))}
      </div>
    </div>
  );
};

export const AccessControlPage: React.FC = () => {
  const { isBranchAdmin } = usePermission();
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [userForm, setUserForm] = useState<UserFormState>(emptyUserForm);
  const [roleForm, setRoleForm] = useState<RoleFormState>(emptyRoleForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 删除确认对话框
  const deleteUserConfirm = useConfirmDialog();
  const deleteRoleConfirm = useConfirmDialog();
  const [pendingDeleteUser, setPendingDeleteUser] = useState<AccessUser | null>(null);
  const [pendingDeleteRole, setPendingDeleteRole] = useState<AccessRole | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [userList, roleList] = await Promise.all([
        apiClient.listUsers(),
        apiClient.listRoles(),
      ]);
      setUsers(userList);
      setRoles(roleList);
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const roleOptions = useMemo(
    () => roles.map(role => ({ label: role.name, value: role.role })),
    [roles]
  );

  const handleUserEdit = (record: AccessUser) => {
    setUserForm({
      id: record.id,
      username: record.username,
      displayName: record.displayName,
      password: '',
      role: record.role,
      organization: record.organization || '',
      allowedRoutes: record.allowedRoutes || [],
      defaultRoute: record.defaultRoute || '',
      allowedIps: joinList(record.allowedIps),
      active: record.active,
    });
  };

  const resetUserForm = () => setUserForm(emptyUserForm);

  const handleUserSubmit = async () => {
    setError('');
    // 所有校验在 setLoading(true) 之前，避免 loading 状态闪烁
    if (!userForm.displayName.trim() || !userForm.role) {
      setError('请完善用户信息');
      return;
    }
    if (!userForm.id && (!userForm.username.trim() || !userForm.password.trim())) {
      setError('新建用户需要用户名和密码');
      return;
    }
    const payload = {
      displayName: userForm.displayName.trim(),
      role: userForm.role,
      organization: userForm.organization.trim() || undefined,
      allowedRoutes: userForm.allowedRoutes,
      defaultRoute: userForm.defaultRoute.trim() || undefined,
      allowedIps: splitIpList(userForm.allowedIps),
      active: userForm.active,
    };
    setLoading(true);
    try {
      if (userForm.id) {
        await apiClient.updateUser(userForm.id, {
          ...payload,
          password: userForm.password.trim() || undefined,
        });
      } else {
        await apiClient.createUser({
          username: userForm.username.trim(),
          password: userForm.password.trim(),
          ...payload,
        });
      }
      resetUserForm();
      await loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleUserDelete = async (record: AccessUser) => {
    setLoading(true);
    setError('');
    try {
      await apiClient.deleteUser(record.id);
      await loadData();
      deleteUserConfirm.hide();
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除失败';
      setError(message);
      deleteUserConfirm.hide(); // 关闭弹窗，让用户在页面顶部看到错误
    } finally {
      setLoading(false);
    }
  };

  const handleRoleEdit = (record: AccessRole) => {
    setRoleForm({
      role: record.role,
      name: record.name,
      dataScope: record.dataScope,
      allowedRoutes: record.allowedRoutes || [],
      defaultRoute: record.defaultRoute || '',
    });
  };

  const resetRoleForm = () => setRoleForm(emptyRoleForm);

  const handleRoleSubmit = async () => {
    setError('');
    if (!roleForm.role.trim() || !roleForm.name.trim()) {
      setError('请完善角色信息');
      return;
    }
    const payload = {
      name: roleForm.name.trim(),
      dataScope: roleForm.dataScope,
      allowedRoutes: roleForm.allowedRoutes,
      defaultRoute: roleForm.defaultRoute.trim() || undefined,
    };
    setLoading(true);
    try {
      const exists = roles.some(role => role.role === roleForm.role);
      if (exists) {
        await apiClient.updateRole(roleForm.role, payload);
      } else {
        await apiClient.createRole({
          role: roleForm.role.trim(),
          ...payload,
        });
      }
      resetRoleForm();
      await loadData();
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleDelete = async (record: AccessRole) => {
    setLoading(true);
    setError('');
    try {
      await apiClient.deleteRole(record.role);
      await loadData();
      deleteRoleConfirm.hide();
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除失败';
      setError(message);
      deleteRoleConfirm.hide(); // 关闭弹窗，让用户在页面顶部看到错误
    } finally {
      setLoading(false);
    }
  };

  if (!isBranchAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">用户与权限管理</h1>
          <p className="text-sm text-neutral-500 mt-1">管理员可配置用户、角色、IP 与路由权限</p>
        </div>
        <Button variant="secondary" onClick={loadData} loading={loading}>
          刷新
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 text-danger px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* 特殊功能权限说明 */}
      <Card title="特殊功能访问控制" subtitle="以下功能通过代码白名单控制，需修改配置文件才能变更" padding="standard">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="rounded-lg border border-neutral-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-success" />
              <span className="text-sm font-medium text-neutral-800">成本分析 <span className="text-xs text-neutral-400">/cost</span></span>
            </div>
            <p className="text-xs text-neutral-500 mb-2">仅以下用户可见并访问：</p>
            <div className="flex flex-wrap gap-1">
              {COST_ALLOWED_USERS.map(u => (
                <span key={u} className="px-2 py-0.5 rounded-full bg-success/10 text-success text-xs font-mono">{u}</span>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-neutral-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-warning" />
              <span className="text-sm font-medium text-neutral-800">费用分析 <span className="text-xs text-neutral-400">/fee-analysis</span></span>
            </div>
            <p className="text-xs text-neutral-500 mb-2">仅以下用户可见并访问（超级用户）：</p>
            <div className="flex flex-wrap gap-1">
              {FEE_ANALYSIS_ALLOWED_USERS.map(u => (
                <span key={u} className="px-2 py-0.5 rounded-full bg-warning/10 text-warning-dark text-xs font-mono">{u}</span>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-neutral-200 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-sm font-medium text-neutral-800">摩意模型 <span className="text-xs text-neutral-400">/moto-cost</span></span>
            </div>
            <p className="text-xs text-neutral-500 mb-2">仅以下用户可见并访问（超级用户）：</p>
            <div className="flex flex-wrap gap-1">
              {MOTO_COST_ALLOWED_USERS.map(u => (
                <span key={u} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-mono">{u}</span>
              ))}
            </div>
          </div>
        </div>
        <p className="text-xs text-neutral-400 mt-3">
          如需调整白名单，请修改 <code className="bg-neutral-100 px-1 rounded">src/shared/config/organizations.ts</code> 中对应的常量并重新部署。
        </p>
      </Card>

      {/* 用户管理 */}
      <Card
        title="用户管理"
        subtitle="创建或编辑用户权限"
        extra={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={resetUserForm}>
              清空
            </Button>
            <Button onClick={handleUserSubmit} loading={loading}>
              {userForm.id ? '更新用户' : '创建用户'}
            </Button>
          </div>
        }
        padding="standard"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <FormItem label="用户名">
            <Input
              value={userForm.username}
              disabled={!!userForm.id}
              onChange={(e) => setUserForm(prev => ({ ...prev, username: e.target.value }))}
              placeholder="如 admin"
            />
          </FormItem>
          <FormItem label="显示名称">
            <Input
              value={userForm.displayName}
              onChange={(e) => setUserForm(prev => ({ ...prev, displayName: e.target.value }))}
            />
          </FormItem>
          <FormItem label="密码">
            <Input
              type="password"
              value={userForm.password}
              onChange={(e) => setUserForm(prev => ({ ...prev, password: e.target.value }))}
              placeholder={userForm.id ? '留空则不修改' : '请输入密码'}
            />
          </FormItem>
          <FormItem label="角色">
            <Select
              value={userForm.role}
              options={roleOptions}
              onChange={(e) => setUserForm(prev => ({ ...prev, role: e.target.value }))}
              placeholder="选择角色"
            />
          </FormItem>
          <FormItem label="所属机构">
            <Input
              value={userForm.organization}
              onChange={(e) => setUserForm(prev => ({ ...prev, organization: e.target.value }))}
              placeholder="可选，如 乐山"
            />
          </FormItem>
          <FormItem label="默认路由">
            <Input
              value={userForm.defaultRoute}
              onChange={(e) => setUserForm(prev => ({ ...prev, defaultRoute: e.target.value }))}
              placeholder="如 /dashboard"
            />
          </FormItem>
          <FormItem label="允许登录 IP">
            <Input
              value={userForm.allowedIps}
              onChange={(e) => setUserForm(prev => ({ ...prev, allowedIps: e.target.value }))}
              placeholder="192.168.1.10, 10.0.0.5（留空不限）"
            />
          </FormItem>
          <FormItem label="启用状态">
            <Select
              value={userForm.active ? 'true' : 'false'}
              onChange={(e) => setUserForm(prev => ({ ...prev, active: e.target.value === 'true' }))}
              options={[
                { label: '启用', value: 'true' },
                { label: '停用', value: 'false' },
              ]}
            />
          </FormItem>
        </div>

        <FormItem label="允许访问路由" className="mt-4">
          <RouteCheckboxGroup
            selected={userForm.allowedRoutes}
            onChange={(routes) => setUserForm(prev => ({ ...prev, allowedRoutes: routes }))}
          />
        </FormItem>

        <div className="mt-6">
          <Table<AccessUser>
            rowKey="id"
            dataSource={users}
            loading={loading}
            columns={[
              { key: 'username', title: '用户名', dataIndex: 'username' },
              { key: 'displayName', title: '显示名称', dataIndex: 'displayName' },
              { key: 'role', title: '角色', dataIndex: 'role' },
              { key: 'organization', title: '机构', dataIndex: 'organization' },
              {
                key: 'active',
                title: '状态',
                render: (_, record) => (
                  <span className={record.active ? 'text-success' : 'text-neutral-400'}>
                    {record.active ? '启用' : '停用'}
                  </span>
                ),
              },
              {
                key: 'allowedRoutes',
                title: '路由白名单',
                render: (_, record) => {
                  const count = record.allowedRoutes?.length ?? 0;
                  return count > 0 ? `${count} 条` : <span className="text-neutral-400">不限</span>;
                },
              },
              {
                key: 'allowedIps',
                title: 'IP 白名单',
                render: (_, record) => {
                  const count = record.allowedIps?.length ?? 0;
                  return count > 0 ? `${count} 条` : <span className="text-neutral-400">不限</span>;
                },
              },
              {
                key: 'actions',
                title: '操作',
                render: (_, record) => (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="small" onClick={() => handleUserEdit(record)}>
                      编辑
                    </Button>
                    <Button
                      variant="danger"
                      size="small"
                      onClick={() => {
                        setPendingDeleteUser(record);
                        deleteUserConfirm.show();
                      }}
                    >
                      删除
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Card>

      {/* 角色管理 */}
      <Card
        title="角色管理"
        subtitle="配置角色数据范围与路由权限"
        extra={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={resetRoleForm}>
              清空
            </Button>
            <Button onClick={handleRoleSubmit} loading={loading}>
              保存角色
            </Button>
          </div>
        }
        padding="standard"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <FormItem label="角色编码">
            <Input
              value={roleForm.role}
              disabled={roles.some(role => role.role === roleForm.role)}
              onChange={(e) => setRoleForm(prev => ({ ...prev, role: e.target.value }))}
              placeholder="如 branch_admin"
            />
          </FormItem>
          <FormItem label="角色名称">
            <Input
              value={roleForm.name}
              onChange={(e) => setRoleForm(prev => ({ ...prev, name: e.target.value }))}
            />
          </FormItem>
          <FormItem label="数据范围">
            <Select
              value={roleForm.dataScope}
              onChange={(e) => setRoleForm(prev => ({ ...prev, dataScope: e.target.value as RoleFormState['dataScope'] }))}
              options={[
                { label: '全量', value: 'all' },
                { label: '本机构', value: 'org' },
                { label: '电销', value: 'telemarketing' },
              ]}
            />
          </FormItem>
          <FormItem label="默认路由">
            <Input
              value={roleForm.defaultRoute}
              onChange={(e) => setRoleForm(prev => ({ ...prev, defaultRoute: e.target.value }))}
              placeholder="如 /dashboard"
            />
          </FormItem>
        </div>

        <FormItem label="允许访问路由" className="mt-4">
          <RouteCheckboxGroup
            selected={roleForm.allowedRoutes}
            onChange={(routes) => setRoleForm(prev => ({ ...prev, allowedRoutes: routes }))}
          />
        </FormItem>

        <div className="mt-6">
          <Table<AccessRole>
            rowKey="role"
            dataSource={roles}
            loading={loading}
            columns={[
              { key: 'role', title: '角色编码', dataIndex: 'role' },
              { key: 'name', title: '名称', dataIndex: 'name' },
              { key: 'dataScope', title: '数据范围', dataIndex: 'dataScope' },
              {
                key: 'allowedRoutes',
                title: '路由白名单',
                render: (_, record) => {
                  const count = record.allowedRoutes?.length ?? 0;
                  return count > 0 ? `${count} 条` : <span className="text-neutral-400">不限</span>;
                },
              },
              {
                key: 'actions',
                title: '操作',
                render: (_, record) => (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="small" onClick={() => handleRoleEdit(record)}>
                      编辑
                    </Button>
                    <Button
                      variant="danger"
                      size="small"
                      onClick={() => {
                        setPendingDeleteRole(record);
                        deleteRoleConfirm.show();
                      }}
                    >
                      删除
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Card>

      {/* 删除用户确认弹窗 */}
      <ConfirmDialog
        open={deleteUserConfirm.open}
        onClose={deleteUserConfirm.hide}
        onConfirm={() => pendingDeleteUser && handleUserDelete(pendingDeleteUser)}
        title="删除用户"
        description={`确定要删除用户「${pendingDeleteUser?.displayName || pendingDeleteUser?.username}」吗？此操作不可撤销。`}
        confirmText="删除"
        danger
        loading={loading}
      />

      {/* 删除角色确认弹窗 */}
      <ConfirmDialog
        open={deleteRoleConfirm.open}
        onClose={deleteRoleConfirm.hide}
        onConfirm={() => pendingDeleteRole && handleRoleDelete(pendingDeleteRole)}
        title="删除角色"
        description={`确定要删除角色「${pendingDeleteRole?.name}」吗？绑定该角色的用户将失去权限，请确认已重新分配。`}
        confirmText="删除"
        danger
        loading={loading}
      />
    </div>
  );
};
