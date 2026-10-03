// The sample opened at start: a Spot-like quadruped (body + 4 three-segment legs) of boxes/spheres, so it renders
// without meshes, with revolute joints so every frame can be posed.
export const SAMPLE_URDF = `<?xml version="1.0"?>
<robot name="spot">
  <material name="body_yellow"><color rgba="0.98 0.82 0.12 1"/></material>
  <material name="hip_dark"><color rgba="0.20 0.20 0.22 1"/></material>
  <material name="leg_gray"><color rgba="0.30 0.31 0.34 1"/></material>
  <material name="foot"><color rgba="0.10 0.10 0.11 1"/></material>

  <link name="body">
    <visual><origin xyz="0 0 0"/><geometry><box size="0.9 0.2 0.16"/></geometry><material name="body_yellow"/></visual>
  </link>

  <link name="front_left_hip">
    <visual><origin xyz="0 0 0"/><geometry><box size="0.10 0.08 0.10"/></geometry><material name="hip_dark"/></visual>
  </link>
  <joint name="front_left_hip_roll" type="revolute">
    <parent link="body"/><child link="front_left_hip"/>
    <origin xyz="0.32 0.115 0"/><axis xyz="1 0 0"/>
    <limit lower="-0.6" upper="0.6" effort="30" velocity="10"/>
  </joint>
  <link name="front_left_upper">
    <visual><origin xyz="0 0 -0.15"/><geometry><box size="0.05 0.05 0.3"/></geometry><material name="leg_gray"/></visual>
  </link>
  <joint name="front_left_upper_pitch" type="revolute">
    <parent link="front_left_hip"/><child link="front_left_upper"/>
    <origin xyz="0 0.06 0"/><axis xyz="0 1 0"/>
    <limit lower="-2.0" upper="2.0" effort="30" velocity="10"/>
  </joint>
  <link name="front_left_lower">
    <visual><origin xyz="0 0 -0.15"/><geometry><box size="0.035 0.035 0.3"/></geometry><material name="leg_gray"/></visual>
    <visual><origin xyz="0 0 -0.3"/><geometry><sphere radius="0.03"/></geometry><material name="foot"/></visual>
  </link>
  <joint name="front_left_lower_knee" type="revolute">
    <parent link="front_left_upper"/><child link="front_left_lower"/>
    <origin xyz="0 0 -0.3"/><axis xyz="0 1 0"/>
    <limit lower="0.0" upper="2.4" effort="30" velocity="10"/>
  </joint>

  <link name="front_right_hip">
    <visual><origin xyz="0 0 0"/><geometry><box size="0.10 0.08 0.10"/></geometry><material name="hip_dark"/></visual>
  </link>
  <joint name="front_right_hip_roll" type="revolute">
    <parent link="body"/><child link="front_right_hip"/>
    <origin xyz="0.32 -0.115 0"/><axis xyz="1 0 0"/>
    <limit lower="-0.6" upper="0.6" effort="30" velocity="10"/>
  </joint>
  <link name="front_right_upper">
    <visual><origin xyz="0 0 -0.15"/><geometry><box size="0.05 0.05 0.3"/></geometry><material name="leg_gray"/></visual>
  </link>
  <joint name="front_right_upper_pitch" type="revolute">
    <parent link="front_right_hip"/><child link="front_right_upper"/>
    <origin xyz="0 -0.06 0"/><axis xyz="0 1 0"/>
    <limit lower="-2.0" upper="2.0" effort="30" velocity="10"/>
  </joint>
  <link name="front_right_lower">
    <visual><origin xyz="0 0 -0.15"/><geometry><box size="0.035 0.035 0.3"/></geometry><material name="leg_gray"/></visual>
    <visual><origin xyz="0 0 -0.3"/><geometry><sphere radius="0.03"/></geometry><material name="foot"/></visual>
  </link>
  <joint name="front_right_lower_knee" type="revolute">
    <parent link="front_right_upper"/><child link="front_right_lower"/>
    <origin xyz="0 0 -0.3"/><axis xyz="0 1 0"/>
    <limit lower="0.0" upper="2.4" effort="30" velocity="10"/>
  </joint>

  <link name="rear_left_hip">
    <visual><origin xyz="0 0 0"/><geometry><box size="0.10 0.08 0.10"/></geometry><material name="hip_dark"/></visual>
  </link>
  <joint name="rear_left_hip_roll" type="revolute">
    <parent link="body"/><child link="rear_left_hip"/>
    <origin xyz="-0.32 0.115 0"/><axis xyz="1 0 0"/>
    <limit lower="-0.6" upper="0.6" effort="30" velocity="10"/>
  </joint>
  <link name="rear_left_upper">
    <visual><origin xyz="0 0 -0.15"/><geometry><box size="0.05 0.05 0.3"/></geometry><material name="leg_gray"/></visual>
  </link>
  <joint name="rear_left_upper_pitch" type="revolute">
    <parent link="rear_left_hip"/><child link="rear_left_upper"/>
    <origin xyz="0 0.06 0"/><axis xyz="0 1 0"/>
    <limit lower="-2.0" upper="2.0" effort="30" velocity="10"/>
  </joint>
  <link name="rear_left_lower">
    <visual><origin xyz="0 0 -0.15"/><geometry><box size="0.035 0.035 0.3"/></geometry><material name="leg_gray"/></visual>
    <visual><origin xyz="0 0 -0.3"/><geometry><sphere radius="0.03"/></geometry><material name="foot"/></visual>
  </link>
  <joint name="rear_left_lower_knee" type="revolute">
    <parent link="rear_left_upper"/><child link="rear_left_lower"/>
    <origin xyz="0 0 -0.3"/><axis xyz="0 1 0"/>
    <limit lower="0.0" upper="2.4" effort="30" velocity="10"/>
  </joint>

  <link name="rear_right_hip">
    <visual><origin xyz="0 0 0"/><geometry><box size="0.10 0.08 0.10"/></geometry><material name="hip_dark"/></visual>
  </link>
  <joint name="rear_right_hip_roll" type="revolute">
    <parent link="body"/><child link="rear_right_hip"/>
    <origin xyz="-0.32 -0.115 0"/><axis xyz="1 0 0"/>
    <limit lower="-0.6" upper="0.6" effort="30" velocity="10"/>
  </joint>
  <link name="rear_right_upper">
    <visual><origin xyz="0 0 -0.15"/><geometry><box size="0.05 0.05 0.3"/></geometry><material name="leg_gray"/></visual>
  </link>
  <joint name="rear_right_upper_pitch" type="revolute">
    <parent link="rear_right_hip"/><child link="rear_right_upper"/>
    <origin xyz="0 -0.06 0"/><axis xyz="0 1 0"/>
    <limit lower="-2.0" upper="2.0" effort="30" velocity="10"/>
  </joint>
  <link name="rear_right_lower">
    <visual><origin xyz="0 0 -0.15"/><geometry><box size="0.035 0.035 0.3"/></geometry><material name="leg_gray"/></visual>
    <visual><origin xyz="0 0 -0.3"/><geometry><sphere radius="0.03"/></geometry><material name="foot"/></visual>
  </link>
  <joint name="rear_right_lower_knee" type="revolute">
    <parent link="rear_right_upper"/><child link="rear_right_lower"/>
    <origin xyz="0 0 -0.3"/><axis xyz="0 1 0"/>
    <limit lower="0.0" upper="2.4" effort="30" velocity="10"/>
  </joint>
</robot>`
