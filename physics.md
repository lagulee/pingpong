---
paths:
  - "public/shared/physics.js"
  - "public/shared/constants.js"
  - "tests/physics*"
---

# 물리 엔진 사양

## 규격·상수 (constants.js)

| 항목 | 값 |
|---|---|
| 공 질량 | `m = 0.0027 kg` |
| 공 반지름 | `r = 0.020 m` |
| 탁구대 | `2.74 × 1.525 m`, 높이 `0.76 m` |
| 네트 높이 | `0.1525 m` |
| 중력가속도 | `g = 9.8 m/s²` |
| 공기 밀도 | `ρ = 1.2 kg/m³` |
| 항력계수 | `C_D ≈ 0.5` (튜닝 가능) |
| 마그누스 계수 | `K_M` (튜닝 가능) |
| 회전 감쇠 | `SPIN_DECAY` (튜닝 가능) |
| 테이블 반발계수 | `e ≈ 0.89 ~ 0.92` |
| 테이블 마찰 | `MU_TABLE` (튜닝 가능) |

튜닝 가능한 값은 디버그 패널에서 바꿀 수 있도록 하나의 객체(`TUNABLE`)로 export한다.

## 운동 방정식

공에 작용하는 힘은 중력, 공기 저항, 마그누스 힘이다.

$$m\frac{d\vec v}{dt} = m\vec g - \tfrac12 C_D \rho A |\vec v|\,\vec v + K_M(\vec\omega \times \vec v), \quad A = \pi r^2$$

- 탑스핀 → 아래로 떨어짐, 백스핀 → 떠서 길어짐, 횡회전 → 옆으로 휨
- 회전 `ω`는 매 스텝 `SPIN_DECAY` 비율로 감쇠한다.

## 적분

- 고정 시간 간격 `dt = 1/240 s`, 반암시적 오일러(속도 먼저 → 그 속도로 위치)
- 화면 프레임과 무관하게 누적 시간(accumulator) 방식으로 고정 스텝만 진행한다.
- `step(state, dt)`의 결과는 입력 상태와 `dt`만으로 정해져야 한다.

```javascript
export function step(b, dt) {
  const v = b.vel, w = b.spin, speed = Math.hypot(v.x, v.y, v.z);
  const drag = -K_D * speed;               // K_D = 0.5·C_D·ρ·A / m
  const mag = cross(w, v);
  const a = {
    x: drag * v.x + K_M * mag.x,
    y: drag * v.y + K_M * mag.y,
    z: drag * v.z + K_M * mag.z - G,
  };
  v.x += a.x * dt; v.y += a.y * dt; v.z += a.z * dt;
  b.pos.x += v.x * dt; b.pos.y += v.y * dt; b.pos.z += v.z * dt;
  b.spin = scale(w, 1 - SPIN_DECAY * dt);
}
```

## 테이블 바운드

- 수직: `v_z' = -e · v_z`
- 수평: 접촉점 미끄러짐 속도 `v_t + ω × r_c`에 마찰을 적용해 회전 일부를 진행 속도로 전환한다.
  - 탑스핀: 바운드 후 앞으로 뻗음
  - 백스핀: 바운드 후 멈칫·느려짐
- 탁구대 모서리에 맞으면 `edge` 이벤트를 발생시킨다.
- 바운드, 네트 접촉, 라켓 접촉, 바닥 낙하는 모두 **이벤트 목록**으로 반환한다. 규칙 판정과 사운드가 이 이벤트를 사용한다.
  - 형식: `{ type, t, pos, speed, side }`

## 충돌 (터널링 방지)

- 스매시(~25 m/s)는 한 스텝에 약 10 cm 이동한다.
- 라켓·네트·테이블 충돌은 "이전 위치 → 현재 위치" **선분과 평면의 교차**로 검사한다.
- 네트에 걸리면 속도 대부분을 흡수한다. 넘어가면 네트 인으로 처리한다.

## 검증 테스트 (tests/physics.test.js)

- [ ] 높이 30.5 cm에서 회전 없이 떨어뜨린 공이 24~26 cm 튀어 오른다 (`e = √(h₂/h₁)`).
- [ ] 같은 초기 속도에서 비행 거리가 탑스핀 < 무회전 < 백스핀 순이다.
- [ ] 횡회전 공이 회전 방향과 맞는 쪽으로 휜다.
- [ ] 바운드 직후 수평 속도가 탑스핀 공 > 백스핀 공이다.
- [ ] 30 m/s로 라켓을 향해 날아가는 공이 라켓을 통과하지 않는다.
- [ ] 같은 입력으로 두 번 시뮬레이션하면 결과가 완전히 같다 (결정론).
- [ ] 공기 중 비행 동안 역학적 에너지가 증가하지 않는다 (마그누스 힘은 일을 하지 않음).
