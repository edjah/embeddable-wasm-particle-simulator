#include "emscripten.h"
#include <cstdio>
#include <utility>
#include <vector>
#include <cstdlib>
#include <cmath>

struct Vector {
    double x;
    double y;

    double squared_norm() {
        return x*x + y*y;
    }

    double norm() {
        return sqrt(squared_norm());
    }

    double dot(const Vector& other) {
        return x*other.x + y*other.y;
    }

    Vector unit_vector() {
        return (*this) * (1 / norm());
    }

    Vector operator+(const Vector& other) {
        Vector copy = *this;
        return (copy += other);
    }

    Vector& operator+=(const Vector& other) {
        this->x += other.x;
        this->y += other.y;
        return *this;
    }

    Vector operator-(const Vector& other) {
        Vector copy = *this;
        return (copy -= other);
    }

    Vector operator-=(const Vector& other) {
        this->x -= other.x;
        this->y -= other.y;
        return *this;
    }

    Vector operator*(const double scalar) {
        Vector copy = *this;
        return (copy *= scalar);
    }

    Vector& operator*=(const double scalar) {
        this->x *= scalar;
        this->y *= scalar;
        return *this;
    }

    Vector operator/(const double scalar) {
        Vector copy = *this;
        return (copy /= scalar);
    }

    Vector operator/=(const double scalar) {
        this->x /= scalar;
        this->y /= scalar;
        return *this;
    }
};

struct Particle {
    Vector position;
    Vector velocity;
    Vector net_force;
    double mass;
    double radius;
    int color;
    int id;
};

// global constants
double G = 200.0;
double elasticity = 1.0;
bool absorb_mode = false;

// global state
std::vector<Particle> particles;
int curr_particle_id = 0;


// internal physics functions
void update_positions(double dt) {
    // zero out forces
    for (Particle& p : particles) {
        p.net_force *= 0;
    }

    // update forces
    for (size_t i = 0; i < particles.size(); ++i) {
        Particle& p1 = particles[i];
        if (p1.mass == 0) {
            continue;
        }

        for (size_t j = i + 1; j < particles.size(); ++j) {
            Particle& p2 = particles[j];
            if (p2.mass == 0) {
                continue;
            }

            Vector diff = p1.position - p2.position;

            // don't compute force for particles that are intersecting
            if (diff.norm() < p1.radius + p2.radius) {
              continue;
            }

            // compute G * m1 * m2 / d^2
            double mult = G * p1.mass * p2.mass / diff.squared_norm();
            Vector force_vec = diff.unit_vector() * mult;
            p1.net_force -= force_vec;
            p2.net_force += force_vec;
        }
    }

    // compute acceleration and update velocity and position
    for (Particle& p : particles) {
        p.velocity += p.net_force * (dt / p.mass);
        p.position += p.velocity * dt;
    }
}

void collide(Particle& p1, Particle &p2, double dt) {
    if (absorb_mode) {
        // a very hacky but simple way of implemenenting absorb mode.
        // simply set the mass of the smaller particle to 0 so that it won't
        // be considered again in subsequent calculations
        // TODO: do the dead particles incur a significant performance overhead?
        if (p1.mass < p2.mass) {
            std::swap(p1, p2);
        }

        // weighted average of position and momentum
        Vector center_of_mass = p1.position * p1.mass + p2.position * p2.mass;
        Vector net_momentum = p1.velocity * p1.mass + p2.velocity * p2.mass;
        p1.position = center_of_mass / (p1.mass + p2.mass);
        p1.velocity = net_momentum / (p1.mass + p2.mass);

        // also compute a weighted average of color :O
        int r1 = p1.color >> 16, g1 = (p1.color >> 8) % 256, b1 = p1.color % 256;
        int r2 = p2.color >> 16, g2 = (p2.color >> 8) % 256, b2 = p2.color % 256;

        int red = (r1 * p1.mass + r2 * p2.mass) / (p1.mass + p2.mass);
        int green = (g1 * p1.mass + g2 * p2.mass) / (p1.mass + p2.mass);
        int blue = (b1 * p1.mass + b2 * p2.mass) / (p1.mass + p2.mass);
        p1.color = (red << 16) + (green << 8) + blue;

        p1.mass += p2.mass;
        p1.radius = sqrt(p1.mass);
        p2.mass = 0;
        p2.radius = 0;

        return;
    }

    Vector direction = (p1.position - p2.position).unit_vector();
    Vector relative_velocity = p1.velocity - p2.velocity;

    double collision_strength = relative_velocity.dot(direction);
    collision_strength *= p1.mass * p2.mass * (1 + elasticity);
    collision_strength /= (p1.mass + p2.mass);


    Vector impulse = direction * collision_strength;
    p1.velocity -= impulse / p1.mass;
    p2.velocity += impulse / p2.mass;

    // move the particles so that they are no longer colliding
    // TODO: this causes some weird behavior when >= 3 particles touch
    while ((p1.position - p2.position).norm() < p1.radius + p2.radius) {
        p1.position += p1.velocity * dt;
        p2.position += p2.velocity * dt;
    }
}

void calculate_collisions(double dt) {
    // only supporting bouncing for now. no merging
    // only supporting collisions of 2 items at a time. no multiparticle
    for (size_t i = 0; i < particles.size(); ++i) {
        Particle& p1 = particles[i];
        if (p1.mass == 0) {
            continue;
        }

        for (size_t j = i + 1; j < particles.size(); ++j) {
            Particle& p2 = particles[j];
            if (p2.mass == 0) {
                continue;
            }

            Vector diff = (p1.position - p2.position);
            if (diff.norm() < p1.radius + p2.radius) {
                collide(p1, p2, dt);
            }
        }
    }
}


// public API
extern "C" {

EMSCRIPTEN_KEEPALIVE
void add_particle(double px, double py, double vx, double vy, double mass, double radius, int color) {
    particles.push_back({
        .position = {px, py},
        .velocity = {vx, vy},
        .net_force = {0, 0},
        .mass = mass,
        .radius = radius,
        .color = color,
        .id = curr_particle_id++
    });
}

EMSCRIPTEN_KEEPALIVE
size_t get_num_particles() {
    return particles.size();
}

EMSCRIPTEN_KEEPALIVE
double get_position_x(int particle_id) {
    return particles[particle_id].position.x;
}

EMSCRIPTEN_KEEPALIVE
double get_position_y(int particle_id) {
    return particles[particle_id].position.y;
}

EMSCRIPTEN_KEEPALIVE
double get_mass(int particle_id) {
    return particles[particle_id].mass;
}

EMSCRIPTEN_KEEPALIVE
double get_radius(int particle_id) {
    return particles[particle_id].radius;
}

EMSCRIPTEN_KEEPALIVE
double get_color(int particle_id) {
    return particles[particle_id].color;
}

EMSCRIPTEN_KEEPALIVE
void step_simulation(double dt, int num_rounds) {
    for (int i = 0; i < num_rounds; ++i) {
        update_positions(dt);
        calculate_collisions(dt);
    }
}

EMSCRIPTEN_KEEPALIVE
void set_G(double new_value) {
    G = new_value;
}

EMSCRIPTEN_KEEPALIVE
void set_elasticity(double new_value) {
    elasticity = new_value;
}

EMSCRIPTEN_KEEPALIVE
void set_absorb_mode(bool new_value) {
    absorb_mode = new_value;
}

} // extern "C"

