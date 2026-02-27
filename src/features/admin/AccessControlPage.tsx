import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { usePermission } from '../../shared/contexts/PermissionContext';
import { apiClient, AccessUser, AccessRole } from '../../shared/api/client';
import { Button, Card, FormItem, Input, Select, Table, TextArea } from '../../shared/ui';

type UserFormState = {
  id?: string;
  username: string;
  displayName: string;
  password: string;
  role: string;
  organization: string;
  allowedRoutes: string;
  defaultRoute: string;
  allowedIps: string;
  active: boolean;
};

type RoleFormState = {
  role: string;
  name: string;
  dataScope: 'all' | 'org' | 'telemarketing';
  allowedRoutes: string;
  defaultRoute: string;
};

const emptyUserForm: UserFormState = {
  username: '',
  displayName: '',
  password: '',
  role: '',
  organization: '',
  allowedRoutes: '',
  defaultRoute: '',
  allowedIps: '',
  active: true,
};

const emptyRoleForm: RoleFormState = {
  role: '',
  name: '',
  dataScope: 'org',
  allowedRoutes: '',
  defaultRoute: '',
};

const splitList = (value: string): string[] => {
  return value
    .split(/[,，\n]/)
    .map(item => item.trim())
    .filter(Boolean);
};

const joinList = (value?: string[]): string => {
  if (!value || value.length === 0) return '';
  return value.join(', ');
};

export const AccessControlPage: React.FC = () => {
  const { isBranchAdmin } = usePermission();
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [userForm, setUserForm] = useState<UserFormState>(emptyUserForm);
  const [roleForm, setRoleForm] = useState<RoleFormState>(emptyRoleForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      allowedRoutes: joinList(record.allowedRoutes),
      defaultRoute: record.defaultRoute || '',
      allowedIps: joinList(record.allowedIps),
      active: record.active,
    });
  };

  const resetUserForm = () => {
    setUserForm(emptyUserForm);
  };

  const handleUserSubmit = async () => {
    setError('');
    const payload = {
      displayName: userForm.displayName.trim(),
      role: userForm.role,
      organization: userForm.organization.trim() || undefined,
      allowedRoutes: splitList(userForm.allowedRoutes),
      defaultRoute: userForm.defaultRoute.trim() || undefined,
      allowedIps: splitList(userForm.allowedIps),
      active: userForm.active,
    };
    if (!userForm.displayName.trim() || !userForm.role) {
      setError('请完善用户信息');
      return;
    }
    setLoading(true);
    try {
      if (userForm.id) {
        await apiClient.updateUser(userForm.id, {
          ...payload,
          password: userForm.password.trim() || undefined,
        });
      } else {
        if (!userForm.username.trim() || !userForm.password.trim()) {
          setError('新建用户需要用户名和密码');
          return;
        }
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
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除失败';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleEdit = (record: AccessRole) => {
    setRoleForm({
      role: record.role,
      name: record.name,
      dataScope: record.dataScope,
      allowedRoutes: joinList(record.allowedRoutes),
      defaultRoute: record.defaultRoute || '',
    });
  };

  const resetRoleForm = () => {
    setRoleForm(emptyRoleForm);
  };

  const handleRoleSubmit = async () => {
    setError('');
    if (!roleForm.role.trim() || !roleForm.name.trim()) {
      setError('请完善角色信息');
      return;
    }
    const payload = {
      name: roleForm.name.trim(),
      dataScope: roleForm.dataScope,
      allowedRoutes: splitList(roleForm.allowedRoutes),
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
    } catch (err) {
      const message = err instanceof Error ? err.message : '删除失败';
      setError(message);
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
              placeholder="可选"
            />
          </FormItem>
          <FormItem label="默认路由">
            <Input
              value={userForm.defaultRoute}
              onChange={(e) => setUserForm(prev => ({ ...prev, defaultRoute: e.target.value }))}
              placeholder="如 /dashboard"
            />
          </FormItem>
          <FormItem label="允许访问路由">
            <TextArea
              value={userForm.allowedRoutes}
              onChange={(e) => setUserForm(prev => ({ ...prev, allowedRoutes: e.target.value }))}
              placeholder="/dashboard, /performance-analysis"
              rows={2}
            />
          </FormItem>
          <FormItem label="允许登录 IP">
            <TextArea
              value={userForm.allowedIps}
              onChange={(e) => setUserForm(prev => ({ ...prev, allowedIps: e.target.value }))}
              placeholder="192.168.1.10, 10.0.0.5"
              rows={2}
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
                render: (_, record) => (record.active ? '启用' : '停用'),
              },
              {
                key: 'allowedIps',
                title: 'IP 白名单',
            render: (_, record) => joinList(record.allowedIps) || '-',
              },
              {
                key: 'allowedRoutes',
                title: '路由白名单',
              render: (_, record) => joinList(record.allowedRoutes) || '-',
              },
              {
                key: 'actions',
                title: '操作',
                render: (_, record) => (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="small" onClick={() => handleUserEdit(record)}>
                      编辑
                    </Button>
                    <Button variant="danger" size="small" onClick={() => handleUserDelete(record)}>
                      删除
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Card>

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
            />
          </FormItem>
          <FormItem label="允许访问路由">
            <TextArea
              value={roleForm.allowedRoutes}
              onChange={(e) => setRoleForm(prev => ({ ...prev, allowedRoutes: e.target.value }))}
              rows={2}
            />
          </FormItem>
        </div>

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
                render: (_, record) => joinList(record.allowedRoutes) || '-',
              },
              {
                key: 'actions',
                title: '操作',
                render: (_, record) => (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="small" onClick={() => handleRoleEdit(record)}>
                      编辑
                    </Button>
                    <Button variant="danger" size="small" onClick={() => handleRoleDelete(record)}>
                      删除
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Card>
    </div>
  );
};
